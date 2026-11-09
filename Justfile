mod web 'web/Justfile'

# Run the same checks as CI.
test: web::check

# Build the static app.
build: web::build
