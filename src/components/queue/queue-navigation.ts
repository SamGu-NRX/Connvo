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

export function enterQueueCall(
  meetingId: string,
  location: Pick<Location, "search" | "replace">,
  testAuth: boolean,
): void {
  // Soft navigation removes the eval app's inner Convex auth provider, whose
  // cleanup clears the shared client. A fresh document mounts call auth once.
  location.replace(callQueueDestination(meetingId, location.search, testAuth));
}
