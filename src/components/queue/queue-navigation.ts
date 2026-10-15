/** Keep harness identity across the handoff; production uses only the meeting ID. */
export function callQueueDestination(
  meetingId: string,
  search: string,
  testAuth: boolean,
): string {
  const destination = `/app/call/${encodeURIComponent(meetingId)}`;
  const identity = new URLSearchParams(search).get("as");
  return testAuth && identity && ["A", "B", "C", "O"].includes(identity)
    ? `${destination}?as=${identity}`
    : destination;
}
