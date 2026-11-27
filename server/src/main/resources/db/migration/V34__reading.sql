-- Reading (2.0): web feeds (RSS, Atom) people follow. Circlo fetches each feed once for everyone who follows it and
-- keeps titles, plain-text summaries and links; the article itself is read on its own site. Who follows what is
-- returned only to them, is in their data export, and goes with their account.

CREATE TABLE reading_sources (
    id            BINARY(16)    NOT NULL PRIMARY KEY,
    feed_url      VARCHAR(2048) NOT NULL,
    -- SHA-256 of feed_url: one row per feed however long its address.
    feed_url_hash BINARY(32)    NOT NULL,
    site_url      VARCHAR(2048) NULL,
    title         VARCHAR(200)  NOT NULL,
    -- For conditional requests (If-None-Match, If-Modified-Since).
    etag          VARCHAR(512)  NULL,
    modified      VARCHAR(100)  NULL,
    updated_at    DATETIME(6)   NULL,
    failing_since DATETIME(6)   NULL,
    failures      INT           NOT NULL DEFAULT 0,
    next_check_at DATETIME(6)   NOT NULL,
    created_at    DATETIME(6)   NOT NULL,
    CONSTRAINT uq_reading_sources_feed UNIQUE (feed_url_hash),
    INDEX ix_reading_sources_next (next_check_at)
);

CREATE TABLE reading_articles (
    id           BINARY(16)    NOT NULL PRIMARY KEY,
    source_id    BINARY(16)    NOT NULL,
    guid_hash    BINARY(32)    NOT NULL,
    url          VARCHAR(2048) NOT NULL,
    title        VARCHAR(300)  NOT NULL,
    summary      VARCHAR(400)  NOT NULL,
    author       VARCHAR(200)  NULL,
    published_at DATETIME(6)   NOT NULL,
    created_at   DATETIME(6)   NOT NULL,
    CONSTRAINT uq_reading_articles_guid UNIQUE (source_id, guid_hash),
    INDEX ix_reading_articles_source (source_id, published_at),
    INDEX ix_reading_articles_published (published_at),
    CONSTRAINT fk_reading_articles_source FOREIGN KEY (source_id) REFERENCES reading_sources (id) ON DELETE CASCADE
);

CREATE TABLE reading_follows (
    user_id    BINARY(16)  NOT NULL,
    source_id  BINARY(16)  NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (user_id, source_id),
    INDEX ix_reading_follows_source (source_id),
    CONSTRAINT fk_reading_follows_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_reading_follows_source FOREIGN KEY (source_id) REFERENCES reading_sources (id) ON DELETE CASCADE
);

-- Articles I've opened or marked read.
CREATE TABLE reading_read (
    user_id    BINARY(16) NOT NULL,
    article_id BINARY(16) NOT NULL,
    PRIMARY KEY (user_id, article_id),
    INDEX ix_reading_read_article (article_id),
    CONSTRAINT fk_reading_read_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_reading_read_article FOREIGN KEY (article_id) REFERENCES reading_articles (id) ON DELETE CASCADE
);

-- The drawer's dot: articles Circlo stored after this moment that I haven't read. Moved on when I open Reading.
ALTER TABLE users ADD COLUMN reading_seen_until DATETIME(6) NULL;
