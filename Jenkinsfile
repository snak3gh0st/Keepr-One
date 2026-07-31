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
