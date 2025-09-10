export class ConvexError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public metadata?: any,
  ) {
    super(message);
    this.name = "ConvexError";
  }
}
