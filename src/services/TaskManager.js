import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

class TaskManager extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map();
    this.running = false;
    this.priorityLevels = {
      ACCEPT_OFFER: 1,
      SUBMIT_BID: 2,
      CANCEL_BID: 3,
      RECALCULATE: 4,
    };
  }

  async initialize() {
    this.running = true;
    this.processTasks();
    logger.info('Task manager initialized');
  }

  async addTask(type, data, priority = this.priorityLevels.RECALCULATE) {
    const task = {
      id: Date.now().toString(),
      type,
      data,
      priority,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    this.emit('taskAdded', task);
    logger.debug(`Added task: ${type} with priority ${priority}`);
  }

  async processTasks() {
    while (this.running) {
      try {
        const tasks = Array.from(this.tasks.values())
          .filter((task) => task.status === 'pending')
          .sort((a, b) => a.priority - b.priority);

        if (tasks.length > 0) {
          const task = tasks[0];
          await this.executeTask(task);
        }

        // Small delay to prevent CPU overuse
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        logger.error('Error processing tasks:', error);
      }
    }
  }

  async executeTask(task) {
    try {
      task.status = 'running';
      this.emit('taskStarted', task);

      switch (task.type) {
        case 'ACCEPT_OFFER':
          await this.handleAcceptOffer(task.data);
          break;
        case 'SUBMIT_BID':
          await this.handleSubmitBid(task.data);
          break;
        case 'CANCEL_BID':
          await this.handleCancelBid(task.data);
          break;
        case 'RECALCULATE':
          await this.handleRecalculate(task.data);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }

      task.status = 'completed';
      this.emit('taskCompleted', task);
      this.tasks.delete(task.id);
    } catch (error) {
      task.status = 'failed';
      task.error = error.message;
      this.emit('taskFailed', task);
      logger.error(`Task failed: ${task.type}`, error);
    }
  }

  // Task handlers
  async handleAcceptOffer(data) {
    // TODO: Implement offer acceptance logic
    logger.info('Processing accept offer task:', data);
  }

  async handleSubmitBid(data) {
    // TODO: Implement bid submission logic
    logger.info('Processing submit bid task:', data);
  }

  async handleCancelBid(data) {
    // TODO: Implement bid cancellation logic
    logger.info('Processing cancel bid task:', data);
  }

  async handleRecalculate(data) {
    // TODO: Implement bid recalculation logic
    logger.info('Processing recalculate task:', data);
  }

  // Task status methods
  getTaskStatus(taskId) {
    return this.tasks.get(taskId)?.status;
  }

  getAllTasks() {
    return Array.from(this.tasks.values());
  }

  getPendingTasks() {
    return Array.from(this.tasks.values()).filter(
      (task) => task.status === 'pending',
    );
  }

  // Cleanup
  async cleanup() {
    this.running = false;
    this.tasks.clear();
    logger.info('Task manager cleaned up');
  }
}

export default new TaskManager();
