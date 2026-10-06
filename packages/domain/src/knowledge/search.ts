import { DomainError, KNOWLEDGE_EMBEDDING_DIMENSIONS } from '@shakti/contracts';
import { AGENT_DEFAULTS } from '../ai/agent-defaults';
import type { AiProvider } from '../ai/provider';

/**
 * The staff search's question as an embedding (`inputType: 'query'`, masked by the wrapper), its
 * spend counted for the whole group under the vault's search name and held to its daily cap; or
 * undefined while no `VOYAGE_API_KEY` is set, so the screen says search is not available yet. The
 * search itself runs on the caller's own context (`searchKnowledge`).
 */
export async function knowledgeQueryVector(
  provider: AiProvider,
  question: string,
): Promise<number[] | undefined> {
  if (!provider.embeddingsAvailable) return undefined;
  try {
    const { vectors } = await provider.embed({
      agent: AGENT_DEFAULTS.knowledge.searchName,
      purpose: 'knowledge_search',
      entityId: null,
      caps: [{ paise: AGENT_DEFAULTS.knowledge.searchDailyCapPaise, entityId: null }],
      texts: [question],
      inputType: 'query',
    });
    const vector = vectors[0];
    if (vector?.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS) {
      throw new DomainError('integration_unavailable', 'the search answered no embedding');
    }
    return vector;
  } catch (error) {
    if (
      error instanceof DomainError &&
      error.code === 'rate_limited' &&
      error.details?.reason === 'agent_spend_cap_reached'
    ) {
      throw new DomainError('rate_limited', 'the search reached its daily limit', {
        reason: 'knowledge_search_cap_reached',
      });
    }
    throw error;
  }
}
