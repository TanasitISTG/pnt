// ponytail: partial bun:test shim — covers only what scripts/ use today.
// Install bun-types + add "bun" to tsconfig types when more of the API is needed.
declare module "bun:test" {
  export const mock: {
    module: (specifier: string, factory: () => unknown) => void;
  };
}
