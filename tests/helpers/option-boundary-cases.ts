export type OptionBoundaryClassification =
  | "allowed"
  | "CREDENTIAL_ARGUMENT_FORBIDDEN"
  | "MODEL_CONFIGURATION_FORBIDDEN";

export interface OptionBoundaryCase {
  id: string;
  args: string[];
  expected: OptionBoundaryClassification;
  hiddenMarkers: string[];
}

const markerFor = (id: string): string =>
  `BOUNDARY_${id.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_MARKER`;

const forbidden = (
  id: string,
  optionName: string,
  form: "inline" | "separated",
  expected: Exclude<OptionBoundaryClassification, "allowed">,
): OptionBoundaryCase => {
  const marker = markerFor(id);
  return {
    id,
    args:
      form === "inline"
        ? ["status", `--${optionName}=${marker}`]
        : ["status", `--${optionName}`, marker],
    expected,
    hiddenMarkers: [marker],
  };
};

const allowedOption = (
  id: string,
  optionName: string,
  form: "inline" | "separated",
): OptionBoundaryCase => {
  const marker = markerFor(id);
  return {
    id,
    args:
      form === "inline"
        ? ["status", `--${optionName}=${marker}`]
        : ["status", `--${optionName}`, marker],
    expected: "allowed",
    hiddenMarkers: [],
  };
};

const allowedFileValue = (id: string, value: string): OptionBoundaryCase => ({
  id,
  args: ["scene", "submit", "--file", value],
  expected: "allowed",
  hiddenMarkers: [],
});

export const optionBoundaryCases: OptionBoundaryCase[] = [
  forbidden(
    "credential-camel-separated",
    "clientKey",
    "separated",
    "CREDENTIAL_ARGUMENT_FORBIDDEN",
  ),
  forbidden(
    "credential-snake-inline",
    "client_key",
    "inline",
    "CREDENTIAL_ARGUMENT_FORBIDDEN",
  ),
  forbidden(
    "credential-kebab-separated",
    "client-key",
    "separated",
    "CREDENTIAL_ARGUMENT_FORBIDDEN",
  ),
  forbidden(
    "model-camel-separated",
    "modelConfig",
    "separated",
    "MODEL_CONFIGURATION_FORBIDDEN",
  ),
  forbidden(
    "model-snake-inline",
    "model_config",
    "inline",
    "MODEL_CONFIGURATION_FORBIDDEN",
  ),
  forbidden(
    "model-kebab-separated",
    "model-config",
    "separated",
    "MODEL_CONFIGURATION_FORBIDDEN",
  ),
  forbidden(
    "provider-camel-inline",
    "providerOptions",
    "inline",
    "MODEL_CONFIGURATION_FORBIDDEN",
  ),
  forbidden(
    "provider-snake-separated",
    "provider_options",
    "separated",
    "MODEL_CONFIGURATION_FORBIDDEN",
  ),
  forbidden(
    "provider-kebab-inline",
    "provider-options",
    "inline",
    "MODEL_CONFIGURATION_FORBIDDEN",
  ),
  forbidden(
    "endpoint-camel-separated",
    "endpointUrl",
    "separated",
    "MODEL_CONFIGURATION_FORBIDDEN",
  ),
  forbidden(
    "endpoint-snake-inline",
    "endpoint_url",
    "inline",
    "MODEL_CONFIGURATION_FORBIDDEN",
  ),
  forbidden(
    "endpoint-kebab-separated",
    "endpoint-url",
    "separated",
    "MODEL_CONFIGURATION_FORBIDDEN",
  ),
  forbidden(
    "base-url-camel-inline",
    "baseUrl",
    "inline",
    "MODEL_CONFIGURATION_FORBIDDEN",
  ),
  forbidden(
    "base-url-snake-separated",
    "base_url",
    "separated",
    "MODEL_CONFIGURATION_FORBIDDEN",
  ),
  forbidden(
    "base-url-kebab-inline",
    "base-url",
    "inline",
    "MODEL_CONFIGURATION_FORBIDDEN",
  ),
  allowedOption("lookalike-tokenizer-separated", "tokenizer", "separated"),
  allowedOption(
    "lookalike-client-tokenizer-inline",
    "clientTokenizer",
    "inline",
  ),
  allowedOption("lookalike-model-view-separated", "model-view", "separated"),
  allowedOption(
    "lookalike-endpoint-status-inline",
    "endpoint-status",
    "inline",
  ),
  allowedFileValue("non-option-client-key", "clientKey"),
  allowedFileValue("non-option-runtime-auth", "runtime_auth"),
  allowedFileValue("non-option-endpoint-url", "endpoint-url"),
  allowedFileValue("non-option-base-url", "baseUrl"),
  allowedFileValue("single-hyphen-client-key", "-clientKey"),
  allowedFileValue("single-hyphen-runtime-auth", "-runtime_auth"),
  allowedFileValue("single-hyphen-endpoint-url", "-endpoint-url"),
  allowedFileValue("single-hyphen-base-url", "-baseUrl"),
];
