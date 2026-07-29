import { Model } from '@tylix/orm'

export declare class JobRecord extends Model {
  static table: string
  static fillable: string[]
  static timestamps: boolean
}