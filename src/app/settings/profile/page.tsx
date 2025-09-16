PROJECT_ID="studio-6192531884" # Replace with your project ID
GENERATIVE_LANGUAGE_API_KEY="AIzaSyBh0XZjCSm7JTyO55GHwj-z7oVm2mGEbGQ"
  -X PATCH \
  -H "x-goog-user-project: ${PROJECT_ID}" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://firebasevertexai.googleapis.com/v1beta/projects/${PROJECT_ID}/locations/global/config" \
  -d "{\"generativeLanguageConfig\": {\"apiKey\": \"${GENERATIVE_LANGUAGE_API_KEY}\"}}"
