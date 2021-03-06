const taskcluster = require('taskcluster-client');
const assert = require('assert');
const debug = require('debug')('workerinfo');
const { UNIQUE_VIOLATION } = require('taskcluster-lib-postgres');

const { Worker, TaskQueue } = require('./data');

const DAY = 24 * 60 * 60 * 1000;
const RECENT_TASKS_LIMIT = 20;

const expired = expires => Date.now() > new Date(expires) - DAY;
const shouldUpdateLastDateActive = lastDateActive => Date.now() - new Date(lastDateActive) > DAY / 4;

class WorkerInfo {
  constructor(options) {
    assert(options);
    assert(options.db);
    this.db = options.db;

    // update `expires` values in postgres at this frequency; larger values give less accurate
    // expires times, but reduce database traffic.
    this.updateFrequency = '6 hours';
    this.nextUpdateAt = {};
  }

  /**
   * Mark a value as seen, only actually updating the postgres table row
   * occasionally. This takes the approach of updating the row immediately on
   * the first call, then not updating until `updateFrequency` has elapsed.
   * Thus the `expires` value on a row may be out-of-date by `updateFrequency`.
   *
   * Note that the cache is never purged of outdated entries; this assumes that
   * the process is restarted on a daily
   * basis, so there is not too much time
   * for stale cache entries to accumulate.
   */
  async valueSeen(key, updateExpires) {
    let now = new Date();
    let nextUpdate = this.nextUpdateAt[key];
    if (!nextUpdate || nextUpdate < now) {
      this.nextUpdateAt[key] = taskcluster.fromNow(this.updateFrequency);

      await updateExpires();
    }
  }

  async seen(taskQueueId, workerGroup, workerId) {
    const newExpiration = workerId ? taskcluster.fromNow('1 day') : taskcluster.fromNow('5 days');
    const expires = new Date();
    const promises = [];

    // worker-type seen
    if (taskQueueId) {
      promises.push(this.valueSeen(taskQueueId, async () => {
        // perform an Azure upsert, trying the update first as it is more common
        let tQueue = await TaskQueue.get(this.db, taskQueueId, expires);

        if (tQueue) {
          return tQueue.update(this.db, {
            expires: expired(tQueue.expires) ? newExpiration : tQueue.expires,
            lastDateActive: shouldUpdateLastDateActive(tQueue.lastDateActive) ? new Date() : tQueue.lastDateActive,
          });
        }

        tQueue = await TaskQueue.fromApi(taskQueueId, {
          taskQueueId,
          expires: newExpiration,
          lastDateActive: new Date(),
          description: '',
          stability: 'experimental',
        });
        try {
          await tQueue.create(this.db);
        } catch (err) {
          if (err.code !== UNIQUE_VIOLATION) {
            throw err;
          }
        }
      }));
    }

    // worker seen
    if (taskQueueId && workerGroup && workerId) {
      promises.push(this.valueSeen(`${taskQueueId}/${workerGroup}/${workerId}`, async () => {
        // perform an Azure upsert, trying the update first as it is more common
        let worker = await Worker.get(this.db, taskQueueId, workerGroup, workerId, expires);

        if (worker) {
          let rows = await worker.update(this.db, { expires: newExpiration });
          return Worker.fromDbRows(rows);
        }

        worker = Worker.fromApi(workerId, {
          taskQueueId,
          workerGroup,
          expires: newExpiration,
          recentTasks: [],
          quarantineUntil: new Date(),
          firstClaim: new Date(),
        });
        try {
          await worker.create(this.db);
        } catch (err) {
          if (err.code !== UNIQUE_VIOLATION) {
            throw err;
          }
        }
      }));
    }

    await Promise.all(promises);
  }

  async expire(now) {
    let count;

    debug('Expiring worker-types at: %s, from before %s', new Date(), now);
    count = await this.db.fns.expire_task_queues(now);
    debug('Expired %s worker-types', count);

    debug('Expiring workers at: %s, from before %s', new Date(), now);
    count = await this.db.fns.expire_queue_workers(now);
    debug('Expired %s workers', count);
  }

  async taskSeen(taskQueueId, workerGroup, workerId, tasks) {
    if (!tasks.length) {
      return;
    }

    // Keep track of most recent tasks of a worker
    const worker = await Worker.get(this.db, taskQueueId, workerGroup, workerId, new Date());

    if (!worker || worker.quarantineUntil.getTime() > new Date().getTime()) {
      return;
    }

    const recentTasks = [
      ...worker.recentTasks,
      ...tasks.map(({ status }) => ({ taskId: status.taskId, runId: status.runs.length - 1 })),
    ].slice(-RECENT_TASKS_LIMIT);
    await worker.update(this.db, { recentTasks });
  }

  async upsertTaskQueue({ taskQueueId, stability, description, expires }) {
    let wType = await TaskQueue.get(this.db, taskQueueId, new Date());
    let result;

    if (wType) {
      let rows = await wType.update(this.db, {
        stability: stability || wType.stability,
        description: description || wType.description,
        expires: expires || wType.expires,
      });
      result = TaskQueue.fromDbRows(rows);
    } else {
      wType = await TaskQueue.fromApi(taskQueueId, {
        taskQueueId,
        expires: new Date(expires || taskcluster.fromNow('5 days')),
        lastDateActive: new Date(),
        description: description || '',
        stability: stability || 'experimental',
      });
      try {
        await wType.create(this.db);
      } catch (err) {
        if (err.code !== UNIQUE_VIOLATION) {
          throw err;
        }
      }
      result = wType;
    }

    return result;
  }

  async upsertWorker({ taskQueueId, workerGroup, workerId, expires }) {
    let worker = await Worker.get(this.db, taskQueueId, workerGroup, workerId, new Date());
    let result;

    if (worker) {
      let rows = await worker.update(this.db, { expires });
      result = Worker.fromDbRows(rows);
    } else {
      worker = Worker.fromApi(workerId, {
        taskQueueId,
        workerGroup,
        workerId,
        recentTasks: [],
        expires: expires || taskcluster.fromNow('1 day'),
        quarantineUntil: new Date(),
        firstClaim: new Date(),
      });
      try {
        await worker.create(this.db);
      } catch (err) {
        if (err.code !== UNIQUE_VIOLATION) {
          throw err;
        }
      }
      result = worker;
    }

    return result;
  }
}

module.exports = WorkerInfo;
