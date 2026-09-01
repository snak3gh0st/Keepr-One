ui = false
disable_mlock = true
log_level = "warn"

storage "raft" {
  path    = "/vault/data"
  node_id = "kbot-vault-1"
}

listener "tcp" {
  address            = "0.0.0.0:8200"
  cluster_address    = "0.0.0.0:8201"
  tls_cert_file      = "/vault/tls/server.crt"
  tls_key_file       = "/vault/tls/server.key"
  tls_min_version    = "tls12"
  tls_client_ca_file = "/vault/tls/ca.crt"
}

api_addr     = "https://kbot-vault:8200"
cluster_addr = "https://kbot-vault:8201"
