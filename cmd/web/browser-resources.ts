export type ResourceRef = { $resource: string; id: string };
type Entry = { owner: object; origin: string; kind: string; value: object; drop: () => unknown };
const symbolDispose = Symbol.dispose || Symbol.for('dispose');

/** Live component objects never leave the worker. Only declared owned results register here. */
export class BrowserResources {
  private entries = new Map<string, Entry>();
  get size(): number { return this.entries.size; }
  own(owner: object, origin: string, kind: string, value: unknown): ResourceRef {
    if (!value || typeof value !== 'object') throw new Error('Expected owned component resource with destructor');
    const drop = (value as Record<symbol, unknown>)[symbolDispose];
    if (typeof drop !== 'function') throw new Error('Expected owned component resource with destructor');
    const id = `res_${crypto.randomUUID()}`;
    this.entries.set(id, { owner, origin, kind, value, drop: drop.bind(value) });
    return { $resource: origin, id };
  }
  borrow(ref: unknown, owner: object, kind: string): object {
    const { entry } = this.resolve(ref);
    if (entry.owner !== owner) throw new Error('Resource belongs to another component instance');
    if (entry.kind !== kind) throw new Error(`Wrong resource kind: expected ${kind}, got ${entry.kind}`);
    return entry.value;
  }
  consume(ref: unknown, owner: object, kind: string): object {
    const value = this.borrow(ref, owner, kind);
    const { id } = this.resolve(ref);
    // Ownership transfers to the guest. Its lowering/destructor now owns cleanup,
    // even if the call traps; the public reference must never be reused or dropped.
    this.entries.delete(id);
    return value;
  }
  async release(ref: unknown): Promise<void> {
    const { id, entry } = this.resolve(ref);
    // Destructors may consume their handle before trapping. Never allow reuse or a second drop.
    this.entries.delete(id);
    await entry.drop();
  }
  async releaseOwner(owner: object): Promise<void> {
    const errors: unknown[] = [];
    for (const [id, entry] of this.entries) if (entry.owner === owner) {
      try { await this.release({ $resource: entry.origin, id }); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, `Component resource destruction failed: ${errors.map(String).join('; ')}`);
  }
  private resolve(ref: unknown): { id: string; entry: Entry } {
    const fields = ref as Partial<ResourceRef> | null;
    if (!fields || typeof fields !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(fields)) ||
        !Object.hasOwn(fields, '$resource') || !Object.hasOwn(fields, 'id') ||
        typeof fields.$resource !== 'string' || typeof fields.id !== 'string') throw new Error('Expected resource reference with string $resource and id');
    const entry = this.entries.get(fields.id);
    if (!entry) throw new Error(`Unknown resource ref: ${fields.id}`);
    if (entry.origin !== fields.$resource) throw new Error('Resource origin does not match registered reference');
    return { id: fields.id, entry };
  }
}
