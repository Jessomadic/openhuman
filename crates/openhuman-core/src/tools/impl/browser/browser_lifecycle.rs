use super::*;

impl Drop for BrowserTool {
    fn drop(&mut self) {
        if self.thread_key.lock().ok().is_some_and(|key| key.is_some()) {
            // A later turn in this conversation reuses the module session.
            // Explicit `close` removes it; module shutdown owns final cleanup.
            return;
        }
        if let Ok(mut held) = self.session.try_lock() {
            if let Some(id) = held.take() {
                let client = self.client.clone();
                if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                    runtime.spawn(async move {
                        let _ = client.close_session(&id).await;
                    });
                }
            }
        }
    }
}
