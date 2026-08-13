import type { ConnectorCapabilityRisk } from './connector-command-contract'

export type NationalLifePortalSurface =
  | 'GLOBAL'
  | 'APPLICATION_LIST'
  | 'APPLICATION_DETAIL'
  | 'POLICY_DETAIL'
  | 'FORESIGHT'

export type NationalLifePortalAction = {
  id: string
  label: string
  surface: NationalLifePortalSurface
  risk: ConnectorCapabilityRisk
  requiresUserGesture: boolean
  description: string
}

/// Closed inventory observed in an authenticated National Life/Foresight
/// session. Selectors and carrier tokens deliberately do not live here: an
/// executor release owns those details, while product/UI can safely reason
/// about stable action IDs, effects and confirmation requirements.
export const NATIONAL_LIFE_PORTAL_ACTIONS = [
  { id: 'GLOBAL_EAPP', label: 'Open iGO e-App', surface: 'GLOBAL', risk: 'NAVIGATION_ONLY', requiresUserGesture: true, description: 'Open the iGO e-App workspace through carrier SSO.' },
  { id: 'GLOBAL_LIFE_ILLUSTRATIONS', label: 'Life Illustrations', surface: 'GLOBAL', risk: 'NAVIGATION_ONLY', requiresUserGesture: true, description: 'Open Life Foresight through carrier SSO.' },
  { id: 'GLOBAL_ANNUITY_ILLUSTRATIONS', label: 'Annuity Illustrations', surface: 'GLOBAL', risk: 'NAVIGATION_ONLY', requiresUserGesture: true, description: 'Open the annuity illustration workspace.' },
  { id: 'GLOBAL_RAPIDPROTECT_SOLVE', label: 'RapidProtect Solve', surface: 'GLOBAL', risk: 'NAVIGATION_ONLY', requiresUserGesture: true, description: 'Open the RapidProtect quoting workflow.' },
  { id: 'GLOBAL_INFORCE_ILLUSTRATIONS', label: 'Inforce Illustrations', surface: 'GLOBAL', risk: 'NAVIGATION_ONLY', requiresUserGesture: true, description: 'Open illustration actions for inforce business.' },
  { id: 'GLOBAL_XRAE', label: 'Underwriting Quotes (XRAE)', surface: 'GLOBAL', risk: 'NAVIGATION_ONLY', requiresUserGesture: true, description: 'Open the carrier underwriting quote tool.' },
  { id: 'GLOBAL_INFORMAL_REQUEST', label: 'Informal Request', surface: 'GLOBAL', risk: 'NAVIGATION_ONLY', requiresUserGesture: true, description: 'Open informal underwriting requests.' },
  { id: 'GLOBAL_UPLOAD_DOCUMENTS', label: 'Upload Documents', surface: 'GLOBAL', risk: 'WRITES_CARRIER_DRAFT', requiresUserGesture: true, description: 'Upload documents to the carrier account.' },

  { id: 'APPLICATION_DOWNLOAD_ALL', label: 'Download', surface: 'APPLICATION_LIST', risk: 'READ_ONLY', requiresUserGesture: false, description: 'Acquire the official New Business export.' },
  { id: 'APPLICATION_FILTERS', label: 'Filters', surface: 'APPLICATION_LIST', risk: 'READ_ONLY', requiresUserGesture: false, description: 'Filter the application inventory.' },
  { id: 'APPLICATION_COLUMNS', label: 'Add or Remove Columns', surface: 'APPLICATION_LIST', risk: 'READ_ONLY', requiresUserGesture: false, description: 'Choose visible application columns.' },
  { id: 'APPLICATION_ACTION_STATUS', label: 'Action Required Status', surface: 'APPLICATION_LIST', risk: 'READ_ONLY', requiresUserGesture: false, description: 'Read why an application needs attention.' },
  { id: 'APPLICATION_SAVE_FOR_REVIEW', label: 'Save for review', surface: 'APPLICATION_DETAIL', risk: 'WRITES_CARRIER_DRAFT', requiresUserGesture: true, description: 'Change the carrier review/bookmark state.' },
  { id: 'APPLICATION_SEND_MESSAGE', label: 'Send case message', surface: 'APPLICATION_DETAIL', risk: 'SUBMITS_TO_CARRIER', requiresUserGesture: true, description: 'Send a case communication to National Life.' },
  { id: 'APPLICATION_SEND_REQUIREMENT_MESSAGE', label: 'Send requirement message', surface: 'APPLICATION_DETAIL', risk: 'SUBMITS_TO_CARRIER', requiresUserGesture: true, description: 'Respond in the requirements conversation.' },
  { id: 'APPLICATION_ATTACH_DOCUMENT', label: 'Attach document', surface: 'APPLICATION_DETAIL', risk: 'WRITES_CARRIER_DRAFT', requiresUserGesture: true, description: 'Attach a document before a message or requirement response.' },
  { id: 'IGO_PREPARE_APPLICATION', label: 'Prepare iGO application', surface: 'APPLICATION_DETAIL', risk: 'WRITES_CARRIER_DRAFT', requiresUserGesture: true, description: 'Prefill an iGO e-App draft with the exact reviewed Keepr One data.' },
  { id: 'IGO_UPLOAD_APPLICATION_DOCUMENT', label: 'Upload iGO application document', surface: 'APPLICATION_DETAIL', risk: 'WRITES_CARRIER_DRAFT', requiresUserGesture: true, description: 'Attach a reviewed document to the iGO application draft.' },
  { id: 'IGO_SUBMIT_APPLICATION', label: 'Submit iGO application', surface: 'APPLICATION_DETAIL', risk: 'SUBMITS_TO_CARRIER', requiresUserGesture: true, description: 'Submit the exact reviewed iGO e-App payload and retain the carrier receipt.' },

  { id: 'POLICY_UPLOAD_FORM', label: 'Upload a Form', surface: 'POLICY_DETAIL', risk: 'WRITES_CARRIER_DRAFT', requiresUserGesture: true, description: 'Upload a service form for the selected policy.' },
  { id: 'POLICY_CUSTOMER_VIEW', label: 'Customer View', surface: 'POLICY_DETAIL', risk: 'NAVIGATION_ONLY', requiresUserGesture: true, description: 'Open the policy as represented in the client portal.' },
  { id: 'POLICY_RUN_ILLUSTRATION', label: 'Run Illustration', surface: 'POLICY_DETAIL', risk: 'NAVIGATION_ONLY', requiresUserGesture: true, description: 'Open Foresight in the selected policy context.' },
  { id: 'POLICY_INTEREST_CREDITED', label: 'Interest Credited', surface: 'POLICY_DETAIL', risk: 'READ_ONLY', requiresUserGesture: true, description: 'Open the interest-credit calculation tool.' },
  { id: 'POLICY_SUBMIT_CLAIM', label: 'Submit a Claim', surface: 'POLICY_DETAIL', risk: 'NAVIGATION_ONLY', requiresUserGesture: true, description: 'Open the death-claim workflow; submission remains a separate confirmed action.' },
  { id: 'POLICY_INVENTORY_LETTER', label: 'Inventory Letter', surface: 'POLICY_DETAIL', risk: 'GENERATES_CARRIER_ARTIFACT', requiresUserGesture: true, description: 'Generate a policy values statement.' },
  { id: 'POLICY_DOWNLOAD_TRANSACTIONS', label: 'Download transactions', surface: 'POLICY_DETAIL', risk: 'READ_ONLY', requiresUserGesture: false, description: 'Acquire the official policy transaction export.' },
  { id: 'POLICY_DOWNLOAD_COMMISSIONS', label: 'Download commission history', surface: 'POLICY_DETAIL', risk: 'READ_ONLY', requiresUserGesture: false, description: 'Acquire the official policy commission export.' },
  { id: 'POLICY_RETRIEVE_DOCUMENTS', label: 'Retrieve Selected', surface: 'POLICY_DETAIL', risk: 'READ_ONLY', requiresUserGesture: true, description: 'Retrieve selected correspondence documents.' },
  { id: 'POLICY_MERGE_DOCUMENTS', label: 'Merge All PDF', surface: 'POLICY_DETAIL', risk: 'GENERATES_CARRIER_ARTIFACT', requiresUserGesture: true, description: 'Generate one PDF from policy correspondence.' },
  { id: 'POLICY_DOWNLOAD_ATTACHMENTS', label: 'Download Attachments', surface: 'POLICY_DETAIL', risk: 'READ_ONLY', requiresUserGesture: true, description: 'Retrieve case-archive attachments.' },

  { id: 'FORESIGHT_CREATE_PRODUCT', label: 'Create a Product Illustration', surface: 'FORESIGHT', risk: 'GENERATES_CARRIER_ARTIFACT', requiresUserGesture: true, description: 'Start a carrier illustration.' },
  { id: 'FORESIGHT_SELECT_CONTACT', label: 'Select Contact', surface: 'FORESIGHT', risk: 'WRITES_CARRIER_DRAFT', requiresUserGesture: true, description: 'Link a Foresight contact to the current illustration.' },
  { id: 'FORESIGHT_REMOVE_CONTACT', label: 'Remove Contact', surface: 'FORESIGHT', risk: 'WRITES_CARRIER_DRAFT', requiresUserGesture: true, description: 'Remove a linked contact from the current illustration.' },
  { id: 'FORESIGHT_SAVE', label: 'Save', surface: 'FORESIGHT', risk: 'WRITES_CARRIER_DRAFT', requiresUserGesture: true, description: 'Save changes to the current Foresight case.' },
  { id: 'FORESIGHT_SAVE_AS', label: 'Save As', surface: 'FORESIGHT', risk: 'WRITES_CARRIER_DRAFT', requiresUserGesture: true, description: 'Create a saved copy of the current Foresight case.' },
  { id: 'FORESIGHT_COPY_TO', label: 'Copy To', surface: 'FORESIGHT', risk: 'WRITES_CARRIER_DRAFT', requiresUserGesture: true, description: 'Copy the current illustration into another destination.' },
  { id: 'FORESIGHT_RUN_REPORTS', label: 'Run Reports', surface: 'FORESIGHT', risk: 'GENERATES_CARRIER_ARTIFACT', requiresUserGesture: true, description: 'Render carrier illustration reports.' },
  { id: 'FORESIGHT_INSMARK', label: 'InsMark', surface: 'FORESIGHT', risk: 'GENERATES_CARRIER_ARTIFACT', requiresUserGesture: true, description: 'Launch the InsMark integration for the current case.' },
  { id: 'FORESIGHT_CASE_LIST', label: 'Case List', surface: 'FORESIGHT', risk: 'READ_ONLY', requiresUserGesture: false, description: 'Read saved Foresight cases.' },
  { id: 'FORESIGHT_FOLDER_LIST', label: 'Folder List', surface: 'FORESIGHT', risk: 'READ_ONLY', requiresUserGesture: false, description: 'Read Foresight folders.' },
  { id: 'FORESIGHT_UNSAVED_CASES', label: 'Unsaved Cases List', surface: 'FORESIGHT', risk: 'READ_ONLY', requiresUserGesture: false, description: 'Read unsaved Foresight cases.' },
  { id: 'FORESIGHT_CONTACT_LIST', label: 'Contact List', surface: 'FORESIGHT', risk: 'READ_ONLY', requiresUserGesture: false, description: 'Read Foresight contacts.' },
] as const satisfies readonly NationalLifePortalAction[]

export function nationalLifePortalActionsFor(surface: NationalLifePortalSurface) {
  return NATIONAL_LIFE_PORTAL_ACTIONS.filter((action) => action.surface === surface)
}
