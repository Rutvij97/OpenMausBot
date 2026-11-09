import type { Coordinator } from "../coordinator.ts";
import { steeredWorkOrigin, type WorkOrigin } from "../peer-provenance.ts";
import type { Message } from "../store.ts";
import { linePersonKey } from "./thread-person.ts";

export interface SteeredRequestOwner { generation: string; messageId?: string; stopped?: boolean; origin?: WorkOrigin }

export function createSteeredRequests(deps: {
  owner: (threadId: string) => SteeredRequestOwner | undefined;
  line: (threadId: string, messageId: string) => Message | undefined;
  requote: Coordinator["requote"];
}) {
  return {
    /** Read before the engine is handed the words: a later turn in the same chat must not take them. */
    generation: (threadId: string): string | undefined => deps.owner(threadId)?.generation,
    /** `personsOwn`: the server saw the person send this line themselves, not a bot, an app or an API caller. The turn's
     * record changes only once its work tree's root has taken the words, so the two never disagree. */
    requote(threadId: string, generation: string | undefined, line: Message, personsOwn: boolean): boolean {
      const owner = deps.owner(threadId);
      if (!personsOwn || generation === undefined || !owner || owner.stopped || owner.generation !== generation) return false;
      const started = owner.messageId ? deps.line(threadId, owner.messageId) : undefined;
      if (linePersonKey(started) !== linePersonKey(line)) return false;
      const next = steeredWorkOrigin(owner.origin, line);
      if (next?.kind !== "user" || !deps.requote(generation, next.request)) return false;
      owner.origin = next;
      return true;
    },
  };
}
export type SteeredRequests = ReturnType<typeof createSteeredRequests>;
