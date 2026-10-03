use serde::{Serialize, Serializer};

/// Единый тип ошибки. Во фронтенд уходит как человекочитаемая строка (см. `Serialize`).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Network(String),
    #[error("Ошибка ввода-вывода: {0}")]
    Io(#[from] std::io::Error),
    #[error("Не удалось разобрать ответ сервиса: {0}")]
    Json(#[from] serde_json::Error),
    /// Сервис ответил ошибкой. `message` уже готов для показа пользователю.
    #[error("{message}")]
    Upstream { status: u16, message: String },
    #[error("{0}")]
    Msg(String),
}

impl AppError {
    pub fn msg(text: impl Into<String>) -> Self {
        AppError::Msg(text.into())
    }

    pub fn status(&self) -> Option<u16> {
        match self {
            AppError::Upstream { status, .. } => Some(*status),
            _ => None,
        }
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        let host = err
            .url()
            .and_then(|u| u.host_str())
            .unwrap_or("сервер")
            .to_string();
        if let Some(status) = err.status() {
            let code = status.as_u16();
            return AppError::Upstream {
                status: code,
                message: crate::net::status_message(code),
            };
        }
        let text = if err.is_timeout() {
            format!("{host} не отвечает. Проверьте интернет или режим сети в Настройки → Сеть")
        } else if err.is_connect() {
            format!("Не удалось подключиться к {host}. Проверьте интернет, VPN или режим сети в Настройки → Сеть")
        } else if err.is_decode() || err.is_body() {
            format!("Соединение с {host} оборвалось при получении данных")
        } else {
            format!("Сетевая ошибка при обращении к {host}")
        };
        AppError::Network(text)
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Обрезает длинные строки (не даём заливать UI).
pub fn truncate(mut text: String, max: usize) -> String {
    if text.len() > max {
        let mut cut = max;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
        text.push('…');
    }
    text
}

/// Проверка идентификаторов, приходящих из фронтенда (защита от подстановки путей).
pub fn check_id(id: &str) -> AppResult<()> {
    let ok = !id.is_empty()
        && id.len() <= 160
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '-' | '.'));
    if ok {
        Ok(())
    } else {
        Err(AppError::msg(format!("Некорректный идентификатор: {id}")))
    }
}
