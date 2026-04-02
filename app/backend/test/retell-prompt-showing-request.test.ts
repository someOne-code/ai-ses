import assert from "node:assert/strict";
import test from "node:test";

import { showingRequestStatePrompt } from "../src/modules/retell/prompt-source/states/showing-request.js";

test("thin showing_request prompt keeps explicit missing-field priority order", () => {
  const prompt = showingRequestStatePrompt;
  const customerNameIndex = prompt.indexOf(
    "1. if customerName is missing, ask for the caller name"
  );
  const visitDayIndex = prompt.indexOf(
    "2. else if the visit day is missing, ask for the day"
  );
  const customerPhoneIndex = prompt.indexOf(
    "3. else if customerPhone is missing or not yet explicitly confirmed, do the callback-number step"
  );
  const timePreferenceIndex = prompt.indexOf(
    "4. else if time preference is missing, ask for the time question"
  );
  const submitIndex = prompt.indexOf(
    "5. else call create_showing_request immediately"
  );

  assert.ok(customerNameIndex >= 0);
  assert.ok(visitDayIndex > customerNameIndex);
  assert.ok(customerPhoneIndex > visitDayIndex);
  assert.ok(timePreferenceIndex > customerPhoneIndex);
  assert.ok(submitIndex > timePreferenceIndex);
});

test("thin showing_request prompt blocks completion language and close behavior while required fields are missing", () => {
  const prompt = showingRequestStatePrompt;

  assert.match(
    prompt,
    /From listing_help, keep one already selected listing active\. Do not ask again for its code or title\./
  );
  assert.match(
    prompt,
    /If the caller says "bu ev", "bunu", "onu", or "bu ilan", keep that listing and continue\./
  );
  assert.match(
    prompt,
    /Never say the request is complete, received, submitted, or being forwarded while any required field is still missing or unclear\./
  );
  assert.match(
    prompt,
    /Never use end_call while any required field is still missing or unclear\./
  );
  assert.match(
    prompt,
    /Do not use completion wording such as "talebinizi aldim" or "iletiyorum" before the required fields are complete\./
  );
  assert.match(
    prompt,
    /If the caller has not decided the day yet or may call later, say briefly that submission still needs a day\./
  );
  assert.match(
    prompt,
    /If they clearly defer the day, do not repeat the day question in that same exchange; use the neutral hold pattern unless they re-engage with a day\./
  );
  assert.match(
    prompt,
    /"Sonra tekrar arayayim" or "gunu sonra netlestireyim" is not by itself permission to close\./
  );
  assert.match(
    prompt,
    /If the caller keeps repeating the same visit-day deferral, do not switch into callback-later language and do not ask the day question again\./
  );
  assert.match(
    prompt,
    /Use one neutral hold pattern only\./
  );
  assert.match(
    prompt,
    /After the first same visit-day deferral repeat, give one short neutral hold line that the request still cannot move without a day and they can say the day when ready, then stop\./
  );
  assert.match(
    prompt,
    /In that neutral hold line, do not tell the caller to call, write, message, or come back later\./
  );
  assert.match(
    prompt,
    /Avoid words like "arayin", "yazin", "tekrar", or "bekleriz"\./
  );
  assert.match(
    prompt,
    /If the day is still missing after that hold line and the caller replies only with "tamam", "evet", or "olur", answer once with one final blocker line such as "Bu talep icin gun bilgisi gerekiyor\." Keep it as a blocker, not goodbye\./
  );
  assert.match(
    prompt,
    /Do not mirror that bare acknowledgment in the final blocker\./
  );
  assert.match(
    prompt,
    /Do not begin it with "tamam", "evet", or similar acknowledgment words\./
  );
  assert.match(
    prompt,
    /Do not treat that acknowledgment as permission to close, end_call, or wrap up\./
  );
  assert.match(
    prompt,
    /After that final blocker line, if the caller still gives only non-day acknowledgments or the same deferral without a day, simply do not respond and do not generate any closing wording\./
  );
  assert.match(
    prompt,
    /Do not output the literal token "NO_RESPONSE_NEEDED"\./
  );
  assert.match(
    prompt,
    /Do not ask another question, do not close the conversation yourself, and do not say "sonra tekrar baslayalim"\./
  );
});

test("thin showing_request prompt requires spoken callback-number read-back and confirmation before submit", () => {
  const prompt = showingRequestStatePrompt;

  assert.match(
    prompt,
    /Never call create_showing_request immediately after first hearing a callback number\./
  );
  assert.match(
    prompt,
    /First read the callback number back digit by digit in short blocks \(for example: 5 0 5 6 \.\.\.\), then ask "Dogru mu\?" explicitly\./
  );
  assert.match(
    prompt,
    /Do not call create_showing_request until the caller explicitly confirms that read-back with "evet" or "dogru"\./
  );
  assert.match(
    prompt,
    /If the caller speaks a new callback number, read it back in short blocks and get explicit confirmation\./
  );
  assert.match(
    prompt,
    /Do not ask the caller to dictate the exact same new full number again if you already heard all digits\./
  );
  assert.match(
    prompt,
    /Never silently persist a newly spoken callback number without read-back confirmation\./
  );
  assert.match(
    prompt,
    /if \{\{user_number\}\} is available, ask one short approval question before using it\./i
  );
  assert.match(
    prompt,
    /If the caller answers the phone question only with "tamam", "evet", or "olur", treat that as invalid, do not mirror it back, tighten the question once, then wait for digits or an explicit stop instead of looping\./
  );
});

test("thin showing_request prompt treats generic acknowledgments as invalid visit-day answers", () => {
  const prompt = showingRequestStatePrompt;

  assert.match(
    prompt,
    /If the caller answers the day question only with "tamam", "evet", or "olur", treat that as invalid, do not mirror it back, and ask once more in a tighter format such as bugun, yarin, hafta ici, or hafta sonu\./
  );
});

test("thin showing_request prompt repairs only customerPhone after a phone failure", () => {
  const prompt = showingRequestStatePrompt;

  assert.match(
    prompt,
    /If create_showing_request returns repairStep=customerPhone, repair only customerPhone\./
  );
  assert.match(
    prompt,
    /Do not reopen listing, customerName, visit day, or time if they were already collected\./
  );
  assert.match(
    prompt,
    /Discard the failed phone candidate and ask for the full number again from the beginning in short blocks\./
  );
  assert.match(
    prompt,
    /Do not ask whether the same broken number is correct\./
  );
  assert.match(
    prompt,
    /If the caller repeats the same failed number, or only says evet or dogru after the failure, say that the number is still not usable and ask for a different reachable number\./
  );
  assert.match(
    prompt,
    /Do not retry create_showing_request until a new full callback number has been collected and explicitly confirmed\./
  );
  assert.doesNotMatch(prompt, /repair only the name/i);
});

test("thin showing_request prompt removes duplicated workflow narration while keeping the contract guards", () => {
  const prompt = showingRequestStatePrompt;

  assert.doesNotMatch(prompt, /Good customer-facing patterns:/);
  assert.doesNotMatch(prompt, /Bad patterns:/);
  assert.doesNotMatch(prompt, /Speech and runtime rules:/);
  assert.doesNotMatch(prompt, /Internal persistence rules:/);
  assert.doesNotMatch(prompt, /Web-call callback wording rules:/);
  assert.doesNotMatch(prompt, /Phone-call contact wording rules:/);
});

test("thin showing_request prompt stays bounded while keeping the required guards", () => {
  const thinPrompt = showingRequestStatePrompt;
  assert.ok(
    thinPrompt.length < 5750,
    `Expected showing_request prompt to stay below the thin-state budget. Length=${thinPrompt.length}.`
  );
  assert.match(
    thinPrompt,
    /Never call create_showing_request as a probe to discover missing or invalid data\./
  );
  assert.match(
    thinPrompt,
    /If create_showing_request returns repairStep=preferredDatetime or repairStep=preferredTimeWindow, repair only scheduling\./
  );
});
