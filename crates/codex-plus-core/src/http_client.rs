pub fn proxied_client(user_agent: &str) -> anyhow::Result<reqwest::Client> {
    let ua = if user_agent.trim().is_empty() {
        format!("CodexPlusPlus/{}", env!("CARGO_PKG_VERSION"))
    } else {
        user_agent.trim().to_string()
    };
    // 关闭系统代理：避免 macOS 系统代理拦截 127.0.0.1 测试请求
    // 真实生产请求 base_url 通常是公网域名，不受 no_proxy 影响
    Ok(reqwest::Client::builder()
        .user_agent(ua)
        .no_proxy()
        .build()?)
}
