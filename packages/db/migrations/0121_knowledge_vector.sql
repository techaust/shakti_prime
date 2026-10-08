-- The Knowledge Vault's embeddings (ADR 0011, docs/03-roadmap-appendix/phase1.md §8.4) are pgvector columns
-- (`knowledge_chunks.embedding vector(1024)`, an HNSW index with cosine distance). The extension
-- lives in public, as pg_trgm does (0003): never enable it from the dashboard's extensions page,
-- which would place it in the extensions schema (docs/runbooks/DEPLOY.md §1).
create extension if not exists vector with schema public;
