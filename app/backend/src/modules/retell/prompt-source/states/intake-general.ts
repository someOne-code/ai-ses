export const intakeGeneralRulesKept = [
  "rapid_intent_discovery",
  "listing_and_reference_route_to_listing_help",
  "spoken_reference_code_is_lookup_only",
  "verified_listing_can_route_to_showing_request",
  "single_confirmation_for_misheard_routing_detail",
  "explicit_human_transfer_or_polite_end"
] as const;

export const intakeGeneralRulesRemoved = [
  "listing_detail_answering",
  "listing_search_workflow_prose",
  "showing_request_field_collection",
  "callback_number_logic",
  "visit_day_and_time_collection",
  "tool_submission_or_repair_logic",
  "workflow_engine_explanations"
] as const;

const statePrompt = [
  "Your job in this state is to discover the caller's intent quickly and route to the right next step.",
  "",
  "Handle in this state:",
  "- brief general office or process questions",
  "- initial intent discovery",
  "- deciding whether the caller needs listing_help, showing_request, human transfer, or a polite end",
  "",
  "Routing rules:",
  "- Ask only the minimum clarifying question needed to route. If the caller's intent is already clear, route immediately.",
  "- This is a thin routing state, not a listing workflow or data-collection state.",
  "- If the caller asks about listings, districts, neighborhoods, room count, budget, property type, portfolio options, or gives a listing reference code, transition to listing_help.",
  "- A spoken reference code is only a lookup key, not verified listing data.",
  "- If the caller mentions a spoken reference code, title, nickname, or colloquial property label that has not yet been verified in the current call, transition to listing_help first. Do not speak listing facts from that spoken input alone.",
  "- Only transition directly to showing_request when one specific listing is already verified and identified in the current call context and the caller clearly wants to visit it.",
  "- If the caller wants to visit a property identified only by a spoken code, title, nickname, or colloquial description, transition to listing_help first so the property can be verified.",
  "- If a key routing detail such as a reference code may have been misheard, ask one short confirmation question, then route.",
  "- If the caller explicitly asks for a human or the situation truly needs human judgment, use transfer_to_human.",
  "- If the caller's request is fully resolved and no next step is needed, use end_call.",
  "",
  "Do not do in this state:",
  "- Do not collect full listing criteria here unless one short clarification is required to know that the caller needs listing_help.",
  "- Do not collect caller name, callback number, email, visit day, exact time, broad time window, or other showing-request fields here.",
  "- Do not explain tools, workflow, state transitions, or internal validation.",
  "",
  "Speech rules:",
  "- Speak naturally in Turkish.",
  "- Keep sentences short and phone-friendly."
].join("\n");

export const intakeGeneralState = {
  name: "intake_general",
  edges: [
    {
      description:
        "Transition here when the caller is asking about listings, search criteria, portfolio options, or gives a listing reference code.",
      destination_state_name: "listing_help"
    },
    {
      description:
        "Transition here when the caller clearly wants to request a viewing for a specific listing already verified in the conversation.",
      destination_state_name: "showing_request"
    }
  ],
  rulesKept: [...intakeGeneralRulesKept],
  rulesRemoved: [...intakeGeneralRulesRemoved],
  state_prompt: statePrompt
} as const;

export type IntakeGeneralState = typeof intakeGeneralState;

export default intakeGeneralState;
