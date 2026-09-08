No external API integration: this phase builds a PostgreSQL migration-safety classifier that
runs entirely locally -- a WebAssembly PostgreSQL parser (`libpg-query`) called in-process, and
a linter binary (`squawk-cli`) spawned once as a one-time calibration child process. By design,
the analyzer core opens no network connection of any kind (D-11: it is a pure function of SQL
text plus rules -- no filesystem, no database connection, no remote call) and no module in this
phase contacts a hosted API, SDK, or remote endpoint at any point.
