pid_file = "/tmp/vault-agent.pid"

vault {
  address = "https://kbot-vault:8200"
  ca_cert = "/vault/tls/ca.crt"

  retry {
    num_retries = 12
  }
}

auto_auth {
  method "approle" {
    mount_path = "auth/approle"
    config = {
      role_id_file_path                   = "/vault/approle/role-id"
      secret_id_file_path                 = "/vault/approle/secret-id"
      remove_secret_id_file_after_reading = false
    }
  }

  sink "file" {
    config = {
      path = "/vault/token/token"
      mode = 0400
    }
  }
}
