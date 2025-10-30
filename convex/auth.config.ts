const clientId = process.env.WORKOS_CLIENT_ID;

if (!clientId) {
  throw new Error("WORKOS_CLIENT_ID environment variable is required");
}

export default {
  providers: [
    {
      domain: "https://api.workos.com/",
      applicationID: `convex_${clientId}`,
    },
  ],
};
