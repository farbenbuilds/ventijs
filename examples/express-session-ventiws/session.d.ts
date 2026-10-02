/// The session field the routes and the upgrade handler both read. Declaration merging needs
/// an `interface`, so this is the one place the repo's type-over-interface rule cannot hold.
declare module "express-session" {
  // eslint-disable-next-line typescript/consistent-type-definitions
  interface SessionData {
    userId: string;
  }
}

export {};
