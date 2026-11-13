import type { Model } from './Model.js';

type Row = Record<string, unknown>;
type ModelClass = typeof Model;

/** A trait: takes a model class, returns a class extending it with more. */
export type Trait<Added = {}> = <T extends ModelClass>(Base: T) => T & Added;

// Any trait function: the class it returns is what use() adds.
type AnyTrait = (Base: any) => any;

/** Applies traits to a base model class, left to right. */
export function use<T extends ModelClass>(Base: T): T;
export function use<T extends ModelClass, A extends AnyTrait>(Base: T, a: A): T & ReturnType<A>;
export function use<T extends ModelClass, A extends AnyTrait, B extends AnyTrait>(Base: T, a: A, b: B): T & ReturnType<A> & ReturnType<B>;
export function use<T extends ModelClass, A extends AnyTrait, B extends AnyTrait, C extends AnyTrait>(
    Base: T, a: A, b: B, c: C,
): T & ReturnType<A> & ReturnType<B> & ReturnType<C>;
export function use<T extends ModelClass>(Base: T, ...traits: AnyTrait[]): T;

export interface SearchableStatics {
    /** Rows where any of the trait's fields contains `term` (case-insensitive). */
    search(term: string, options?: { limit?: number }): Promise<Row[]>;
}

/** Adds Model.search(term) over the given columns. */
export function Searchable(options: { fields: string[] }): Trait<SearchableStatics>;

// Only what is exported above is public (helper types stay private).
export {};
