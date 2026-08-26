export type SettingsActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
};

export const INITIAL_SETTINGS_ACTION_STATE: SettingsActionState = {
  status: "idle",
};
