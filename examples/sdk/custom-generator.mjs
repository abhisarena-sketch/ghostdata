// Custom generators are SDK-only: plain functions that receive a seeded RNG.
// They are never accepted from config files or the browser playground.
import { DataGhost } from "../../packages/core/dist/index.js";

const ghost = new DataGhost({ seed: 7 });
ghost.registerGenerator("ticketCode", (ctx) => `TCK-${ctx.rng.string(5, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")}`, { description: "Support ticket code" });

const tickets = await ghost.generate({
  schema: { code: "ticketCode", priority: { type: "enum", values: ["low", "normal", "high"] }, openedAt: "timestamp" },
  count: 3,
});
console.log(tickets);
