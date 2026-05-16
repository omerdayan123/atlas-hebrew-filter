export default {
  root: "api/static",
  server: {
    proxy: {
      "/classify": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
      "/overrides": "http://127.0.0.1:8000",
      "/suggest": "http://127.0.0.1:8000",
      "/validate-detailed": "http://127.0.0.1:8000"
    }
  }
}
