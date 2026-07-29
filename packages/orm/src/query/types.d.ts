// src/query/types.d.ts
export interface WhereClause {
  field: string
  operator: '=' | '!=' | '>' | '<' | '>=' | '<='
  value: unknown
}

export interface OrderClause {
  field: string
  direction: 'ASC' | 'DESC'
}

export interface QueryDescriptor {
  wheres: WhereClause[]
  orders: OrderClause[]
  limitValue?: number
  offsetValue?: number
}