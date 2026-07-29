export interface FieldDefinition {
    type: string;
    required?: boolean;
}

export declare function resolveFieldRuleNames(field: FieldDefinition): string[];