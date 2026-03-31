import {
  getMinimalRetellToolContract,
  type RetellPromptSourceToolName
} from "./tool-descriptions.js";
import { generalPrompt } from "./general.js";
import intakeGeneralState from "./states/intake-general.js";
import {
  listingHelpStateSource,
  listingHelpToolNames
} from "./states/listing-help.js";
import { showingRequestStatePrompt } from "./states/showing-request.js";

export const retellPromptSourceStateNames = [
  "intake_general",
  "listing_help",
  "showing_request"
] as const;

export type RetellPromptSourceStateName =
  (typeof retellPromptSourceStateNames)[number];

interface RetellPromptSourceEdge {
  description: string;
  destination_state_name: RetellPromptSourceStateName;
}

interface RetellPromptSourceBaseTool {
  name: string;
  description: string;
  speak_after_execution: boolean;
}

interface RetellPromptSourceTransferTool extends RetellPromptSourceBaseTool {
  type: "transfer_call";
  speak_during_execution: true;
  execution_message_type: "static_text";
  execution_message_description: string;
  transfer_destination: {
    type: "predefined";
    number: string;
  };
  transfer_option: {
    type: "cold_transfer";
    cold_transfer_mode: "sip_invite";
    enable_bridge_audio_cue: true;
  };
}

interface RetellPromptSourceEndCallTool extends RetellPromptSourceBaseTool {
  type: "end_call";
}

interface RetellPromptSourceCustomTool extends RetellPromptSourceBaseTool {
  type: "custom";
  speak_during_execution: false;
  method: "POST";
  url: string;
  headers: Record<string, never>;
  query_params: Record<string, never>;
  parameters: ReturnType<typeof getMinimalRetellToolContract>["parameters"];
}

interface RetellPromptSourceState {
  name: RetellPromptSourceStateName;
  edges: readonly RetellPromptSourceEdge[];
  state_prompt: string;
  tools?: RetellPromptSourceCustomTool[];
}

export interface RenderedRetellPromptSource {
  model: string;
  model_temperature: number;
  model_high_priority: boolean;
  tool_call_strict_mode: boolean;
  general_prompt: string;
  general_tools: Array<
    RetellPromptSourceTransferTool | RetellPromptSourceEndCallTool
  >;
  states: RetellPromptSourceState[];
  starting_state: "intake_general";
  start_speaker: "agent";
  begin_message: string;
}

export interface RenderRetellPromptSourceOptions {
  toolEndpointUrl: string;
  model?: string;
  modelTemperature?: number;
  modelHighPriority?: boolean;
  toolCallStrictMode?: boolean;
  beginMessage?: string;
}

function renderCustomTool(
  name: RetellPromptSourceToolName,
  toolEndpointUrl: string
): RetellPromptSourceCustomTool {
  const contract = getMinimalRetellToolContract(name);

  return {
    name: contract.name,
    description: contract.description,
    speak_after_execution: true,
    type: "custom",
    speak_during_execution: false,
    method: "POST",
    url: toolEndpointUrl,
    headers: {},
    query_params: {},
    parameters: contract.parameters
  };
}

function buildStates(
  toolEndpointUrl: string
): RenderedRetellPromptSource["states"] {
  return [
    {
      name: intakeGeneralState.name,
      edges: structuredClone(intakeGeneralState.edges),
      state_prompt: intakeGeneralState.state_prompt
    },
    {
      name: listingHelpStateSource.name,
      edges: [
        {
          description:
            "Move here when the caller wants to request a viewing for a specific verified listing.",
          destination_state_name: "showing_request"
        },
        {
          description:
            "Move here when the caller leaves listing help and instead asks a general office or process question.",
          destination_state_name: "intake_general"
        }
      ],
      state_prompt: listingHelpStateSource.statePrompt,
      tools: listingHelpToolNames.map((toolName) =>
        renderCustomTool(toolName, toolEndpointUrl)
      )
    },
    {
      name: "showing_request",
      edges: [
        {
          description:
            "Move here when the caller leaves the showing flow and instead needs general office help.",
          destination_state_name: "intake_general"
        }
      ],
      state_prompt: showingRequestStatePrompt,
      tools: [renderCustomTool("create_showing_request", toolEndpointUrl)]
    }
  ];
}

export function renderRetellPromptSource(
  options: RenderRetellPromptSourceOptions
): RenderedRetellPromptSource {
  return {
    model: options.model ?? "gpt-5.4-mini",
    model_temperature: options.modelTemperature ?? 0,
    model_high_priority: options.modelHighPriority ?? false,
    tool_call_strict_mode: options.toolCallStrictMode ?? true,
    general_prompt: generalPrompt,
    general_tools: [
      {
        name: "transfer_to_human",
        description:
          "Use this when the caller explicitly asks for a human or the matter needs human judgment.",
        type: "transfer_call",
        speak_after_execution: true,
        speak_during_execution: true,
        execution_message_type: "static_text",
        execution_message_description: "Sizi ofisten bir danismana aktariyorum.",
        transfer_destination: {
          type: "predefined",
          number: "{{human_transfer_number}}"
        },
        transfer_option: {
          type: "cold_transfer",
          cold_transfer_mode: "sip_invite",
          enable_bridge_audio_cue: true
        }
      },
      {
        name: "end_call",
        description:
          "Use this when the conversation is clearly complete and the caller needs nothing else.",
        type: "end_call",
        speak_after_execution: true
      }
    ],
    states: buildStates(options.toolEndpointUrl),
    starting_state: "intake_general",
    start_speaker: "agent",
    begin_message:
      options.beginMessage ??
      "Merhaba, ben emlak ofisinin yapay zeka asistaniyim. Size nasil yardimci olabilirim?"
  };
}
