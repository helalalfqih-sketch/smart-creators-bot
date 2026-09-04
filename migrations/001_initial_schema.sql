-- Smart Creators Bot - PostgreSQL Migration Schema
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    telegram_id BIGINT UNIQUE,
    username VARCHAR(255),
    role VARCHAR(32) DEFAULT 'user',
    plan_id VARCHAR(64) DEFAULT 'free',
    status VARCHAR(32) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    telegram_chat_id BIGINT,
    telegram_message_id BIGINT,
    url TEXT NOT NULL,
    platform VARCHAR(64) DEFAULT 'General',
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    stage TEXT DEFAULT 'في قائمة الانتظار...',
    progress INT DEFAULT 0,
    quality VARCHAR(64) DEFAULT 'best',
    format_type VARCHAR(32) DEFAULT 'video',
    is_ai_enhanced BOOLEAN DEFAULT FALSE,
    ai_provider VARCHAR(64),
    title TEXT,
    clean_title TEXT,
    filename TEXT,
    size_bytes BIGINT,
    thumbnail_url TEXT,
    download_url TEXT,
    direct_stream_url TEXT,
    error TEXT,
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    idempotency_key VARCHAR(255) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_updates_processed (
    update_id BIGINT PRIMARY KEY,
    chat_id BIGINT,
    from_id BIGINT,
    message_id BIGINT,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    actor_id VARCHAR(64) NOT NULL,
    actor_type VARCHAR(32) NOT NULL,
    action VARCHAR(128) NOT NULL,
    target_resource VARCHAR(255) NOT NULL,
    details TEXT,
    ip_address VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
