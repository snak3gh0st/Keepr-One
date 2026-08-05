pipeline {
  agent any

  environment {
    NODE_VERSION = '22'
    CI = 'true'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Install deps') {
      steps {
        sh '''
          set -euo pipefail
          corepack enable
          corepack pnpm --version
          corepack pnpm install --frozen-lockfile
        '''
      }
    }

    stage('Lint') {
      steps {
        sh 'corepack pnpm run lint'
      }
    }

    // The root tsconfig excludes apps/keeprone-connect, so `next build` never sees
    // the extension. Without this stage the connector's types are checked nowhere.
    stage('Connector typecheck') {
      steps {
        sh 'corepack pnpm run connector:typecheck'
      }
    }

    stage('Tests') {
      steps {
        sh 'corepack pnpm run test'
      }
    }

    stage('Build') {
      steps {
        sh 'corepack pnpm run build'
      }
    }
  }
}
