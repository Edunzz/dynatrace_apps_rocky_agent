// Rocky Agent runtime on Azure Container Apps.
// Secrets are Key Vault references resolved with a user-assigned managed identity.

@description('Location for all resources.')
param location string = resourceGroup().location

@description('Name prefix for all resources.')
@maxLength(20)
param name string = 'rocky-agent'

@description('Container image pinned by version or digest (never latest).')
param image string = 'ghcr.io/edunzz/dynatrace_apps_rocky_agent:0.1.0'

@description('Dynatrace platform URL, for example https://abc12345.apps.dynatrace.com')
param dtPlatformUrl string

@description('Existing Key Vault (same resource group) that holds the runtime secrets.')
param keyVaultName string

@description('Key Vault secret names.')
param dtPlatformTokenSecretName string = 'dt-platform-token'
param serverPasswordSecretName string = 'server-password'
param modelApiKeySecretName string = 'model-api-key'

@description('Environment variable that receives the model provider key.')
@allowed(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENCODE_API_KEY'])
param modelApiKeyEnv string = 'ANTHROPIC_API_KEY'

param opencodeProvider string = 'anthropic'
param opencodeModel string = 'anthropic/claude-sonnet-4-5'

@description('true: public HTTPS ingress; false: internal ingress (VNet + EdgeConnect).')
param externalIngress bool = true

@description('Optional VNet subnet for an internal environment.')
param infrastructureSubnetId string = ''

@description('CIDR ranges allowed to reach the ingress. Empty allows all.')
param allowedIpRanges array = []

@description('CPU cores and memory (1.0/2Gi recommended; 2.0/4Gi for heavy workloads).')
param cpu string = '1.0'
param memory string = '2Gi'

param logRetentionDays int = 30

var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var kvUri = 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logRetentionDays
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${name}-identity'
  location: location
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource vaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, identity.id, kvSecretsUserRoleId)
  scope: vault
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
  }
}

resource managedEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: empty(infrastructureSubnetId)
      ? null
      : {
          infrastructureSubnetId: infrastructureSubnetId
          internal: !externalIngress
        }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: externalIngress
        targetPort: 4096
        transport: 'http'
        allowInsecure: false
        ipSecurityRestrictions: [
          for (cidr, i) in allowedIpRanges: {
            name: 'allow-${i}'
            ipAddressRange: cidr
            action: 'Allow'
          }
        ]
      }
      secrets: [
        { name: 'dt-platform-token', keyVaultUrl: '${kvUri}/${dtPlatformTokenSecretName}', identity: identity.id }
        { name: 'server-password', keyVaultUrl: '${kvUri}/${serverPasswordSecretName}', identity: identity.id }
        { name: 'model-api-key', keyVaultUrl: '${kvUri}/${modelApiKeySecretName}', identity: identity.id }
      ]
    }
    template: {
      containers: [
        {
          name: 'rocky-agent'
          image: image
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: [
            { name: 'DT_PLATFORM_URL', value: dtPlatformUrl }
            { name: 'DT_PLATFORM_TOKEN', secretRef: 'dt-platform-token' }
            { name: 'OPENCODE_SERVER_USERNAME', value: 'opencode' }
            { name: 'OPENCODE_SERVER_PASSWORD', secretRef: 'server-password' }
            { name: modelApiKeyEnv, secretRef: 'model-api-key' }
            { name: 'OPENCODE_PROVIDER', value: opencodeProvider }
            { name: 'OPENCODE_MODEL', value: opencodeModel }
            { name: 'OPENCODE_PORT', value: '4096' }
            { name: 'NODE_ENV', value: 'production' }
            { name: 'LOG_LEVEL', value: 'info' }
            { name: 'WORKSPACE_PATH', value: '/workspace' }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/rocky/v1/livez', port: 4096 }
              periodSeconds: 5
              failureThreshold: 36
            }
            {
              type: 'Readiness'
              httpGet: { path: '/rocky/v1/livez', port: 4096 }
              periodSeconds: 10
            }
            {
              type: 'Liveness'
              httpGet: { path: '/rocky/v1/livez', port: 4096 }
              periodSeconds: 30
            }
          ]
          volumeMounts: [
            { volumeName: 'workspace', mountPath: '/workspace' }
          ]
        }
      ]
      volumes: [
        { name: 'workspace', storageType: 'EmptyDir' }
      ]
      // Sessions are local to one replica.
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [
    vaultSecretsUser
  ]
}

output fqdn string = app.properties.configuration.ingress.fqdn
output runtimeUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
