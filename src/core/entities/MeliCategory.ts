export class MeliCategorySuggestion {
  category_id: string;
  category_name: string;
  domain_id?: string;
  domain_name?: string;
}

export class MeliAttributeValue {
  id: string;
  name: string;
}

export class MeliCategoryAttribute {
  id: string;
  name: string;
  value_type: string;
  required: boolean;
  allowed_values: MeliAttributeValue[];
  allowed_units: string[];
  hint: string | null;
}
