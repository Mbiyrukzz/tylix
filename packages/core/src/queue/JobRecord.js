import { Model } from '@tylix/orm'

export class JobRecord extends Model {
  static table = 'jobs'
  static fillable = ['job', 'payload', 'status', 'attempts', 'error', 'available_at']
  static timestamps = true
}
