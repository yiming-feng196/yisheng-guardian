-- Local H2 schema, derived from deploy/mysql/init.sql. Never used by the MySQL profile.


CREATE TABLE IF NOT EXISTS `user` (
    id BIGINT NOT NULL AUTO_INCREMENT,
    username VARCHAR(64) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'USER',
    create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_user_username UNIQUE (username),
    CONSTRAINT chk_user_role CHECK (role IN ('USER', 'ADMIN'))
);

CREATE TABLE IF NOT EXISTS user_profile (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    name VARCHAR(100) NULL,
    gender VARCHAR(20) NULL,
    age INT NULL,
    phone VARCHAR(32) NULL,
    medicalhistory TEXT NULL,
    mmse INT NULL,
    moca INT NULL,
    hkbc INT NULL,
    update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_user_profile_user UNIQUE (user_id),
    CONSTRAINT fk_user_profile_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE,
    CONSTRAINT chk_user_profile_age CHECK (age IS NULL OR age BETWEEN 0 AND 130)
);

CREATE TABLE IF NOT EXISTS audio_record (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    duration INT NOT NULL DEFAULT 0,
    upload_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    image_name VARCHAR(255) NULL,
    consent_version VARCHAR(64) NULL,
    consent_time DATETIME NULL,
    task_type VARCHAR(40) NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_audio_record_file_path UNIQUE (file_path),
    CONSTRAINT chk_audio_record_duration CHECK (duration >= 0)
);

CREATE TABLE IF NOT EXISTS screening_task (
    id CHAR(36) NOT NULL,
    user_id BIGINT NOT NULL,
    audio_record_id BIGINT NOT NULL,
    audio_name VARCHAR(255) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    current_stage VARCHAR(32) NOT NULL,
    progress TINYINT NOT NULL DEFAULT 0,
    model_version VARCHAR(128) NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    version BIGINT NOT NULL DEFAULT 0,
    error_code VARCHAR(64) NULL,
    error_message VARCHAR(500) NULL,
    trace_id CHAR(36) NOT NULL,
    requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    started_at DATETIME(3) NULL,
    completed_at DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    CONSTRAINT uk_screening_task_user_idempotency UNIQUE (user_id, idempotency_key),
    CONSTRAINT uk_screening_task_audio UNIQUE (audio_record_id),
    CONSTRAINT fk_screening_task_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE,
    CONSTRAINT fk_screening_task_audio FOREIGN KEY (audio_record_id) REFERENCES audio_record (id) ON DELETE CASCADE,
    CONSTRAINT chk_screening_task_progress CHECK (progress BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS screening_task_artifact (
    id BIGINT NOT NULL AUTO_INCREMENT,
    task_id CHAR(36) NOT NULL,
    artifact_type VARCHAR(32) NOT NULL,
    storage_uri VARCHAR(500) NOT NULL,
    sha256 CHAR(64) NOT NULL,
    content_version INT NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    CONSTRAINT uk_screening_artifact_version UNIQUE (task_id, artifact_type, content_version),
    CONSTRAINT fk_screening_artifact_task FOREIGN KEY (task_id) REFERENCES screening_task (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS outbox_event (
    event_id CHAR(36) NOT NULL,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    schema_version INT NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'NEW',
    attempt_count INT NOT NULL DEFAULT 0,
    next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    published_at DATETIME(3) NULL,
    PRIMARY KEY (event_id),
    KEY idx_outbox_publish (status, next_attempt_at, created_at)
);

CREATE TABLE IF NOT EXISTS consumed_event (
    consumer_name VARCHAR(100) NOT NULL,
    event_id CHAR(36) NOT NULL,
    processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (consumer_name, event_id)
);

CREATE TABLE IF NOT EXISTS diagnosis_report (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    audio_name VARCHAR(255) NOT NULL,
    transcription LONGTEXT NOT NULL,
    report LONGTEXT NOT NULL,
    screening_id VARCHAR(64) NOT NULL,
    screening_task_id CHAR(36) NULL,
    screening_status VARCHAR(24) NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    risk_score DECIMAL(8,7) NULL,
    quality_passed BOOLEAN NULL,
    quality_issues JSON NOT NULL,
    feature_highlights JSON NOT NULL,
    model_version VARCHAR(128) NULL,
    disclaimer_version VARCHAR(64) NOT NULL,
    create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_diagnosis_report_audio UNIQUE (audio_name),
    CONSTRAINT uk_diagnosis_report_screening UNIQUE (screening_id),
    CONSTRAINT uk_diagnosis_report_task UNIQUE (screening_task_id),
    CONSTRAINT fk_diagnosis_report_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE,
    CONSTRAINT fk_diagnosis_report_task FOREIGN KEY (screening_task_id) REFERENCES screening_task (id) ON DELETE SET NULL,
    CONSTRAINT chk_diagnosis_report_status CHECK (screening_status IN ('COMPLETED', 'REVIEW_REQUIRED')),
    CONSTRAINT chk_diagnosis_report_risk CHECK (risk_level IN ('LOW', 'ELEVATED', 'HIGH', 'INCONCLUSIVE')),
    CONSTRAINT chk_diagnosis_report_score CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 1)
);

CREATE TABLE IF NOT EXISTS pdf_report (
    id BIGINT NOT NULL AUTO_INCREMENT,
    screening_task_id CHAR(36) NULL,
    audio_name VARCHAR(255) NOT NULL,
    pdf_name VARCHAR(255) NOT NULL,
    file_sha256 CHAR(64) NULL,
    file_size BIGINT NULL,
    user_id BIGINT NOT NULL,
    create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uk_pdf_report_pdf_name UNIQUE (pdf_name),
    CONSTRAINT uk_pdf_report_audio_name UNIQUE (audio_name),
    CONSTRAINT uk_pdf_report_task UNIQUE (screening_task_id),
    CONSTRAINT fk_pdf_report_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE,
    CONSTRAINT fk_pdf_report_task FOREIGN KEY (screening_task_id) REFERENCES screening_task (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS assistant_conversation (
    id CHAR(36) NOT NULL,
    owner_type VARCHAR(16) NOT NULL,
    owner_key VARCHAR(128) NOT NULL,
    title VARCHAR(120) NOT NULL DEFAULT '新对话',
    user_turn_count INT NOT NULL DEFAULT 0,
    summary_up_to_turn INT NOT NULL DEFAULT 0,
    rolling_summary TEXT NOT NULL,
    generation_status VARCHAR(16) NOT NULL DEFAULT 'IDLE',
    generation_started_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    CONSTRAINT chk_assistant_conversation_owner CHECK (owner_type IN ('USER','ANONYMOUS')),
    CONSTRAINT chk_assistant_conversation_turns CHECK (user_turn_count BETWEEN 0 AND 100),
    CONSTRAINT chk_assistant_conversation_summary_turn CHECK (summary_up_to_turn BETWEEN 0 AND user_turn_count),
    CONSTRAINT chk_assistant_conversation_status CHECK (generation_status IN ('IDLE','GENERATING'))
);

CREATE TABLE IF NOT EXISTS assistant_message (
    id BIGINT NOT NULL AUTO_INCREMENT,
    conversation_id CHAR(36) NOT NULL,
    turn_no INT NOT NULL,
    role VARCHAR(16) NOT NULL,
    content MEDIUMTEXT NOT NULL,
    title VARCHAR(160) NULL,
    intent VARCHAR(80) NULL,
    urgent BOOLEAN NOT NULL DEFAULT FALSE,
    metadata_json JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    CONSTRAINT uk_assistant_message_turn_role UNIQUE (conversation_id, turn_no, role),
    CONSTRAINT fk_assistant_message_conversation FOREIGN KEY (conversation_id)
        REFERENCES assistant_conversation (id) ON DELETE CASCADE,
    CONSTRAINT chk_assistant_message_turn CHECK (turn_no BETWEEN 1 AND 100),
    CONSTRAINT chk_assistant_message_role CHECK (role IN ('USER','ASSISTANT'))
);

CREATE TABLE IF NOT EXISTS assistant_memory (
    id BIGINT NOT NULL AUTO_INCREMENT,
    conversation_id CHAR(36) NOT NULL,
    from_turn INT NOT NULL,
    to_turn INT NOT NULL,
    summary TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    CONSTRAINT uk_assistant_memory_block UNIQUE (conversation_id, from_turn, to_turn),
    CONSTRAINT fk_assistant_memory_conversation FOREIGN KEY (conversation_id)
        REFERENCES assistant_conversation (id) ON DELETE CASCADE,
    CONSTRAINT chk_assistant_memory_range CHECK (from_turn >= 1 AND to_turn >= from_turn AND to_turn <= 100)
);

CREATE INDEX IF NOT EXISTS idx_audio_record_user_time ON audio_record (user_id, upload_time);
CREATE INDEX IF NOT EXISTS idx_screening_task_user_time ON screening_task (user_id, requested_at);
CREATE INDEX IF NOT EXISTS idx_screening_task_status_time ON screening_task (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_diagnosis_report_user_time ON diagnosis_report (user_id, create_time);
CREATE INDEX IF NOT EXISTS idx_pdf_report_user_time ON pdf_report (user_id, create_time);
CREATE INDEX IF NOT EXISTS idx_assistant_conversation_owner_time ON assistant_conversation (owner_type, owner_key, updated_at);
CREATE INDEX IF NOT EXISTS idx_assistant_message_conversation ON assistant_message (conversation_id, turn_no, id);
