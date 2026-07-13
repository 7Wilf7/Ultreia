import { buildDataBlock, estimateTextTokens, messageContentForCoach } from "./coachPrompt";
import { buildSystemPrompt } from "./profile";

export function calculateCoachBaseContextUsage({
  logs,
  races,
  now,
  currentWeather,
  forecastByDate,
  dailyNotes,
  agentActions,
  memoryFacts,
  profile,
  coachConfig,
  chatMessages,
  fixedOverheadTokens = 0,
}, countTokens = estimateTextTokens) {
  let systemTokens;
  try {
    const dataBlock = buildDataBlock({
      logs,
      races,
      now,
      lang: "en",
      currentWeather,
      forecastByDate,
      dailyNotes,
      agentActions,
      memoryFacts,
    });
    systemTokens = countTokens(buildSystemPrompt({
      profile,
      coachConfig,
      dataBlock,
      lang: "en",
    }));
  } catch {
    systemTokens = fixedOverheadTokens;
  }
  const historyTokens = (chatMessages || []).reduce((sum, message) => (
    sum + countTokens(`[${message.role || "user"}]\n${messageContentForCoach(message.content)}`)
  ), 0);
  return { systemTokens, historyTokens };
}

export function scheduleCoachContextCalculation({
  host,
  calculate,
  commit,
  idleTimeout = 1200,
  fallbackDelay = 120,
}) {
  let cancelled = false;
  const run = () => {
    const next = calculate();
    if (!cancelled) commit(next);
  };
  const canUseIdle = typeof host?.requestIdleCallback === "function";
  const id = canUseIdle
    ? host.requestIdleCallback(run, { timeout: idleTimeout })
    : host.setTimeout(run, fallbackDelay);

  return () => {
    cancelled = true;
    if (canUseIdle && typeof host.cancelIdleCallback === "function") {
      host.cancelIdleCallback(id);
    } else {
      host.clearTimeout(id);
    }
  };
}
