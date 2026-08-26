/// The browser uses the same pure protocol definitions as the server. It does
/// not import a server module, database client or secret; independent validation
/// is still performed at every network boundary.
export {
  CONNECTOR_CAPABILITIES,
  CONNECTOR_COMMAND_EVENTS,
  CONNECTOR_COMMAND_PROTOCOL_VERSION,
  isConnectorCapability,
  isReadOnlyCapability,
  parseConnectorCommand,
  parseConnectorCommandEvent,
  requiresExplicitConfirmation,
  type ConnectorCapability,
  type ConnectorCommand,
  type ConnectorCommandEvent,
  type ConnectorCommandEventType,
  type ConnectorCommandState,
} from '../../../lib/national-life/connector-command-contract'
