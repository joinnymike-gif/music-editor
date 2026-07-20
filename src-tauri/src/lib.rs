use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use keyring::Entry;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const KEYCHAIN_SERVICE: &str = "com.aimusicide.desktop.ai";
const MAX_PROMPT_CHARS: usize = 1_600;
const MAX_CONTEXT_NOTES: usize = 120;
const MAX_GENERATED_NOTES: usize = 64;
const REQUEST_TIMEOUT_SECONDS: u64 = 30;
const SESSION_CREDENTIAL_TTL: Duration = Duration::from_secs(12 * 60 * 60);
static AI_HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
static AI_SESSION_CREDENTIALS: OnceLock<Mutex<CredentialCache>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum AiProvider {
    Openai,
    Gemini,
}

impl AiProvider {
    fn keychain_account(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Gemini => "gemini",
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::Openai => "OpenAI",
            Self::Gemini => "Gemini",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiCommandError {
    code: &'static str,
    message: String,
}

impl AiCommandError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

type AiResult<T> = Result<T, AiCommandError>;

#[derive(Clone)]
struct CachedCredential {
    value: String,
    expires_at: Instant,
}

#[derive(Default)]
struct CredentialCache {
    entries: HashMap<AiProvider, CachedCredential>,
}

impl CredentialCache {
    fn get(&mut self, provider: AiProvider, now: Instant) -> Option<String> {
        let entry = self.entries.get(&provider)?;
        if entry.expires_at > now {
            return Some(entry.value.clone());
        }
        self.entries.remove(&provider);
        None
    }

    fn insert(&mut self, provider: AiProvider, value: String, now: Instant) {
        self.entries.insert(
            provider,
            CachedCredential {
                value,
                expires_at: now + SESSION_CREDENTIAL_TTL,
            },
        );
    }

    fn remove(&mut self, provider: AiProvider) {
        self.entries.remove(&provider);
    }
}

fn credential_cache() -> &'static Mutex<CredentialCache> {
    AI_SESSION_CREDENTIALS.get_or_init(|| Mutex::new(CredentialCache::default()))
}

fn cached_credential(provider: AiProvider) -> Option<String> {
    credential_cache()
        .lock()
        .ok()
        .and_then(|mut cache| cache.get(provider, Instant::now()))
}

fn cache_credential(provider: AiProvider, value: String) {
    if let Ok(mut cache) = credential_cache().lock() {
        cache.insert(provider, value, Instant::now());
    }
}

fn clear_cached_credential(provider: AiProvider) {
    if let Ok(mut cache) = credential_cache().lock() {
        cache.remove(provider);
    }
}

fn ai_http_client() -> AiResult<&'static Client> {
    if let Some(client) = AI_HTTP_CLIENT.get() {
        return Ok(client);
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
        .build()
        .map_err(|_| {
            AiCommandError::new("native_ai_unavailable", "无法初始化本机 AI 网络连接。")
        })?;
    let _ = AI_HTTP_CLIENT.set(client);
    AI_HTTP_CLIENT
        .get()
        .ok_or_else(|| AiCommandError::new("native_ai_unavailable", "无法初始化本机 AI 网络连接。"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderStatus {
    provider: AiProvider,
    configured: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAiStatus {
    providers: Vec<ProviderStatus>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScopeNote {
    start: f64,
    dur: f64,
    pitch: i32,
    vel: i32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GenerationScope {
    track_id: String,
    section_id: String,
    section_beats: f64,
    role: String,
    tempo: f64,
    key: String,
    mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GenerateNotesRequest {
    provider: AiProvider,
    prompt: String,
    strategy: String,
    scope: GenerationScope,
    context_notes: Vec<ScopeNote>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GeneratedNote {
    start: f64,
    dur: f64,
    pitch: i32,
    vel: i32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct NoteProposal {
    summary: String,
    notes: Vec<GeneratedNote>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopGenerationResponse {
    provider: AiProvider,
    proposal: NoteProposal,
}

fn keychain_entry(provider: AiProvider) -> AiResult<Entry> {
    Entry::new(KEYCHAIN_SERVICE, provider.keychain_account()).map_err(|_| {
        AiCommandError::new(
            "keychain_unavailable",
            "无法访问 macOS 钥匙串。请解锁钥匙串后重试。",
        )
    })
}

fn configured(provider: AiProvider) -> bool {
    credential(provider).is_ok()
}

fn credential(provider: AiProvider) -> AiResult<String> {
    if let Some(key) = cached_credential(provider) {
        return Ok(key);
    }
    let key = keychain_entry(provider)?.get_password().map_err(|_| {
        AiCommandError::new(
            "ai_not_configured",
            format!(
                "尚未在 macOS 钥匙串中配置 {} API Key。",
                provider.display_name()
            ),
        )
    })?;
    if key.trim().is_empty() {
        return Err(AiCommandError::new(
            "ai_not_configured",
            format!(
                "尚未在 macOS 钥匙串中配置 {} API Key。",
                provider.display_name()
            ),
        ));
    }
    // Keychain access can require the user's login password. Retain the
    // unlocked credential in this native process only, so one confirmation is
    // enough for subsequent generations during the next 12 hours. The cache
    // disappears on app quit and never crosses the WebView boundary.
    cache_credential(provider, key.clone());
    Ok(key)
}

#[tauri::command]
fn get_desktop_ai_status() -> DesktopAiStatus {
    DesktopAiStatus {
        providers: vec![
            ProviderStatus {
                provider: AiProvider::Openai,
                configured: configured(AiProvider::Openai),
            },
            ProviderStatus {
                provider: AiProvider::Gemini,
                configured: configured(AiProvider::Gemini),
            },
        ],
    }
}

#[tauri::command]
fn save_desktop_ai_key(provider: AiProvider, api_key: String) -> AiResult<DesktopAiStatus> {
    let trimmed = api_key.trim();
    if trimmed.len() < 12 {
        return Err(AiCommandError::new(
            "invalid_api_key",
            "API Key 格式无效，请检查后重试。",
        ));
    }
    keychain_entry(provider)?
        .set_password(trimmed)
        .map_err(|_| {
            AiCommandError::new(
                "keychain_write_failed",
                "无法写入 macOS 钥匙串。请确认应用已获得钥匙串访问权限。",
            )
        })?;
    cache_credential(provider, trimmed.to_string());
    Ok(get_desktop_ai_status())
}

#[tauri::command]
fn remove_desktop_ai_key(provider: AiProvider) -> AiResult<DesktopAiStatus> {
    let entry = keychain_entry(provider)?;
    if configured(provider) {
        entry.delete_credential().map_err(|_| {
            AiCommandError::new(
                "keychain_delete_failed",
                "无法从 macOS 钥匙串删除 API Key。",
            )
        })?;
    }
    clear_cached_credential(provider);
    Ok(get_desktop_ai_status())
}

#[tauri::command]
async fn generate_desktop_ai_notes(
    request: GenerateNotesRequest,
) -> AiResult<DesktopGenerationResponse> {
    validate_generation_request(&request)?;
    let api_key = credential(request.provider)?;
    let client = ai_http_client()?;
    let response_text = match request.provider {
        AiProvider::Openai => generate_with_openai(client, &api_key, &request).await?,
        AiProvider::Gemini => generate_with_gemini(client, &api_key, &request).await?,
    };
    let proposal: NoteProposal = serde_json::from_str(&response_text).map_err(|_| {
        AiCommandError::new(
            "invalid_model_response",
            "生成服务返回了无效候选，请修改描述后重试。",
        )
    })?;
    validate_proposal(&proposal, request.scope.section_beats)?;
    Ok(DesktopGenerationResponse {
        provider: request.provider,
        proposal,
    })
}

async fn generate_with_openai(
    client: &Client,
    api_key: &str,
    request: &GenerateNotesRequest,
) -> AiResult<String> {
    let response = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({
          "model": "gpt-5.6",
          "store": false,
          "max_output_tokens": 800,
          "input": [{
            "role": "developer",
            "content": [{ "type": "input_text", "text": system_instruction(request) }]
          }, {
            "role": "user",
            "content": [{ "type": "input_text", "text": request.prompt }]
          }],
          "text": {
            "format": {
              "type": "json_schema",
              "name": "music_note_proposal",
              "strict": true,
              "schema": proposal_schema(true)
            }
          }
        }))
        .send()
        .await
        .map_err(network_error)?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|_| {
        AiCommandError::new("invalid_model_response", "生成服务返回了无法解析的响应。")
    })?;
    if !status.is_success() {
        return Err(provider_http_error(status));
    }
    extract_openai_text(&body)
}

async fn generate_with_gemini(
    client: &Client,
    api_key: &str,
    request: &GenerateNotesRequest,
) -> AiResult<String> {
    let response = client
        .post("https://generativelanguage.googleapis.com/v1beta/interactions")
        .header("x-goog-api-key", api_key)
        .json(&json!({
          "model": "gemini-flash-lite-latest",
          "store": false,
          "system_instruction": system_instruction(request),
          "input": request.prompt,
          "response_format": {
            "type": "text",
            "mime_type": "application/json",
            "schema": proposal_schema(false)
          },
          "generation_config": { "max_output_tokens": 800 }
        }))
        .send()
        .await
        .map_err(network_error)?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|_| {
        AiCommandError::new("invalid_model_response", "生成服务返回了无法解析的响应。")
    })?;
    if !status.is_success() {
        return Err(provider_http_error(status));
    }
    extract_gemini_text(&body)
}

fn system_instruction(request: &GenerateNotesRequest) -> String {
    format!(
    "You create a small MIDI-note proposal for a music editor. Return only the requested JSON schema. Keep summary concise (at most 120 characters). Notes must stay inside the selected section. Do not include IDs, markdown, credentials, personal data, or operations. Selected scope: {}",
    serde_json::to_string(&json!({
      "sectionBeats": request.scope.section_beats,
      "role": request.scope.role,
      "tempo": request.scope.tempo,
      "key": request.scope.key,
      "mode": request.scope.mode,
      "strategy": request.strategy,
      "contextNotes": request.context_notes,
    }))
    .unwrap_or_else(|_| "{}".to_string())
  )
}

fn proposal_schema(strict: bool) -> Value {
    let note = json!({
      "type": "object",
      "required": ["start", "dur", "pitch", "vel"],
      "properties": {
        "start": { "type": "number" },
        "dur": { "type": "number" },
        "pitch": { "type": "integer", "minimum": 0, "maximum": 127 },
        "vel": { "type": "integer", "minimum": 1, "maximum": 127 }
      }
    });
    let mut schema = json!({
      "type": "object",
      "required": ["summary", "notes"],
      "properties": {
        "summary": { "type": "string", "minLength": 1, "maxLength": 300 },
        "notes": { "type": "array", "maxItems": MAX_GENERATED_NOTES, "items": note }
      }
    });
    if strict {
        schema["additionalProperties"] = Value::Bool(false);
        schema["properties"]["notes"]["items"]["additionalProperties"] = Value::Bool(false);
    }
    schema
}

fn extract_openai_text(body: &Value) -> AiResult<String> {
    if let Some(text) = body.get("output_text").and_then(Value::as_str) {
        return Ok(text.to_string());
    }
    for output in body
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        for content in output
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if content.get("type").and_then(Value::as_str) == Some("output_text") {
                if let Some(text) = content.get("text").and_then(Value::as_str) {
                    return Ok(text.to_string());
                }
            }
            if content.get("type").and_then(Value::as_str) == Some("refusal") {
                return Err(AiCommandError::new(
                    "model_refused",
                    "生成服务拒绝了这次请求。请修改描述或改用手工编辑。",
                ));
            }
        }
    }
    Err(AiCommandError::new(
        "invalid_model_response",
        "生成服务没有返回候选文本。",
    ))
}

fn extract_gemini_text(body: &Value) -> AiResult<String> {
    if let Some(text) = body.get("output_text").and_then(Value::as_str) {
        return Ok(text.to_string());
    }
    for step in body
        .get("steps")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if step.get("type").and_then(Value::as_str) != Some("model_output") {
            continue;
        }
        for content in step
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if content.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(text) = content.get("text").and_then(Value::as_str) {
                    return Ok(text.to_string());
                }
            }
        }
    }
    Err(AiCommandError::new(
        "invalid_model_response",
        "生成服务没有返回候选文本。",
    ))
}

fn validate_generation_request(request: &GenerateNotesRequest) -> AiResult<()> {
    if request.prompt.trim().is_empty() || request.prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(AiCommandError::new(
            "invalid_request",
            "提示词必须为 1–1600 个字符。",
        ));
    }
    if request.strategy != "replace" && request.strategy != "overdub" {
        return Err(AiCommandError::new(
            "invalid_request",
            "策略必须为 replace 或 overdub。",
        ));
    }
    if request.scope.section_beats < 1.0 || request.scope.section_beats > 512.0 {
        return Err(AiCommandError::new(
            "invalid_request",
            "sectionBeats 必须为 1–512。",
        ));
    }
    if request.context_notes.len() > MAX_CONTEXT_NOTES {
        return Err(AiCommandError::new(
            "invalid_request",
            "contextNotes 最多包含 120 个音符。",
        ));
    }
    for note in &request.context_notes {
        validate_note(
            note.start,
            note.dur,
            note.pitch,
            note.vel,
            request.scope.section_beats,
        )?;
    }
    Ok(())
}

fn validate_proposal(proposal: &NoteProposal, section_beats: f64) -> AiResult<()> {
    if proposal.summary.trim().is_empty() || proposal.summary.chars().count() > 300 {
        return Err(AiCommandError::new(
            "invalid_model_response",
            "候选摘要无效。",
        ));
    }
    if proposal.notes.len() > MAX_GENERATED_NOTES {
        return Err(AiCommandError::new(
            "invalid_model_response",
            "候选音符数量超过上限。",
        ));
    }
    for note in &proposal.notes {
        validate_note(note.start, note.dur, note.pitch, note.vel, section_beats)?;
    }
    Ok(())
}

fn validate_note(start: f64, dur: f64, pitch: i32, vel: i32, section_beats: f64) -> AiResult<()> {
    if !start.is_finite()
        || !dur.is_finite()
        || start < 0.0
        || dur < 0.0625
        || start + dur > section_beats + f64::EPSILON
        || !(0..=127).contains(&pitch)
        || !(1..=127).contains(&vel)
    {
        return Err(AiCommandError::new(
            "invalid_model_response",
            "候选包含超出当前片段范围或 MIDI 边界的音符。",
        ));
    }
    Ok(())
}

fn network_error(error: reqwest::Error) -> AiCommandError {
    if error.is_timeout() {
        AiCommandError::new(
            "generation_timeout",
            "生成超时，未自动重试。请确认后手动重试。",
        )
    } else {
        AiCommandError::new("provider_unavailable", "生成服务暂时不可用，请稍后重试。")
    }
}

fn provider_http_error(status: StatusCode) -> AiCommandError {
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        AiCommandError::new(
            "provider_configuration_error",
            "所选服务商的 API Key 不可用。",
        )
    } else if status == StatusCode::TOO_MANY_REQUESTS {
        AiCommandError::new("provider_rate_limited", "生成服务繁忙，请稍后手动重试。")
    } else if status.is_server_error() {
        AiCommandError::new("provider_unavailable", "生成服务暂时不可用，请稍后重试。")
    } else {
        AiCommandError::new(
            "provider_request_failed",
            "生成服务未能完成请求，请修改描述后重试。",
        )
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_ai_status,
            save_desktop_ai_key,
            remove_desktop_ai_key,
            generate_desktop_ai_notes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_midi_note_boundaries() {
        assert!(validate_note(15.0, 1.0, 60, 90, 16.0).is_ok());
        assert!(validate_note(15.5, 1.0, 60, 90, 16.0).is_err());
        assert!(validate_note(0.0, 1.0, 128, 90, 16.0).is_err());
    }

    #[test]
    fn extracts_openai_output_without_accepting_a_refusal() {
        let response = json!({
          "output": [{
            "type": "message",
            "content": [{ "type": "output_text", "text": "{\"summary\":\"ok\",\"notes\":[]}" }]
          }]
        });
        assert_eq!(
            extract_openai_text(&response).unwrap(),
            "{\"summary\":\"ok\",\"notes\":[]}"
        );

        let refused = json!({
          "output": [{ "content": [{ "type": "refusal" }] }]
        });
        assert_eq!(
            extract_openai_text(&refused).unwrap_err().code,
            "model_refused"
        );
    }

    #[test]
    fn extracts_gemini_model_output() {
        let response = json!({
          "steps": [{
            "type": "model_output",
            "content": [{ "type": "text", "text": "{\"summary\":\"ok\",\"notes\":[]}" }]
          }]
        });
        assert_eq!(
            extract_gemini_text(&response).unwrap(),
            "{\"summary\":\"ok\",\"notes\":[]}"
        );
    }

    #[test]
    fn rejects_invalid_generation_request_before_reading_a_key() {
        let request = GenerateNotesRequest {
            provider: AiProvider::Gemini,
            prompt: " ".to_string(),
            strategy: "replace".to_string(),
            scope: GenerationScope {
                track_id: "track_1".to_string(),
                section_id: "section_1".to_string(),
                section_beats: 16.0,
                role: "lead".to_string(),
                tempo: 120.0,
                key: "C".to_string(),
                mode: "major".to_string(),
            },
            context_notes: vec![],
        };
        assert_eq!(
            validate_generation_request(&request).unwrap_err().code,
            "invalid_request"
        );
    }

    #[test]
    fn retains_a_key_only_until_the_twelve_hour_session_expiry() {
        let mut cache = CredentialCache::default();
        let now = Instant::now();
        cache.insert(AiProvider::Gemini, "test-key".to_string(), now);

        assert_eq!(
            cache.get(AiProvider::Gemini, now + Duration::from_secs(60)),
            Some("test-key".to_string())
        );
        assert_eq!(
            cache.get(AiProvider::Gemini, now + SESSION_CREDENTIAL_TTL),
            None
        );
    }
}
