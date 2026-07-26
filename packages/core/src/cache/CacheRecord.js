import { Model } from '@tylix/orm'

export class CacheRecord extends Model {
  static table = 'cache'
  static fillable = ['key', 'value', 'expires_at']
  static timestamps = true
}
