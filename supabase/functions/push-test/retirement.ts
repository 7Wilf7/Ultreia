export const PUSH_TEST_RETIREMENT = Object.freeze({
  error: "function_retired",
  stage: "retired",
});

export function retiredPushTestResponse() {
  return {
    status: 410,
    body: { ...PUSH_TEST_RETIREMENT },
  };
}
