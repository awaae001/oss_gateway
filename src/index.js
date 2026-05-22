import { handleRequest } from "./router/index.js";

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};
