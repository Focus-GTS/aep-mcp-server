# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-05-28
### Added
- Initial release with 22 tools across 8 AEP categories
- OAuth 2.0 Server-to-Server authentication with concurrent-refresh-deduped token cache
- Schemas: list, get, create (full CRUD)
- Datasets: list, get, create
- Identities: list namespaces, get identity graph, get profile by identity
- Profiles: get, preview, delete (with confirmation gate)
- Segments: list, create (PQL), estimate size
- Sources: list source catalog, list dataflows
- Destinations: list destination catalog, activate segment
- Query Service: run SQL, get query status, list queries
- Adobe-ecosystem-compatible metadata tagging via `describe()` helper
- Comprehensive live integration test suite
- Pino structured logging to stderr with PII/secret redaction
- Request timeout, retry with exponential backoff, 401 re-auth
- SSRF guard on absolute URLs
- Graceful shutdown handlers (SIGINT/SIGTERM)
