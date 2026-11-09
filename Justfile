mod web 'web/Justfile'

# Run the same checks as CI.
test: web::check web::e2e

# Build the static app.
build: web::build
