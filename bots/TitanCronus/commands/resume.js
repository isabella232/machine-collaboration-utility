const path = require('path');
const botFsmDefinitions = require(path.join(process.env.PWD, 'react/modules/Bots/botFsmDefinitions'));
const jobFsmDefinitions = require(path.join(process.env.PWD, 'react/modules/Jobs/jobFsmDefinitions'));

// Returns an array of purge commands
function purgeCommands(self) {
  const commandArray = [];
  const purgeAmount = 10;
  commandArray.push('G92 E0');
  commandArray.push(`G1 E${purgeAmount} F100`); // Purge
  commandArray.push(`G1 E${purgeAmount - 2} F3000`); // Retract
  commandArray.push('G1 Y' + (0 + Number(self.settings.offsetY)).toFixed(2) + ' F2000'); // Scrub
  commandArray.push('G92 E-2'); // Prepare extruder for E0
  commandArray.push('M400'); // Clear motion buffer before saying we're done
  commandArray.push({
    postCallback: () => { self.parked = false }
  });

  const purgeCheck = {
    postCallback: () => {
      if (self.parked) {
        self.queue.prependCommands(commandArray);
      }
    }
  };
  return purgeCheck;
}

module.exports = async function resume(self, params) {
  try {
    if (self.currentJob === undefined) {
      throw new Error(`Bot ${self.settings.name} is not currently processing a job`);
    }
    if (self.currentJob.fsm.current !== 'paused') {
      throw new Error(`Cannot resume ${self.settings.name} job from state "${self.currentJob.fsm.current}"`);
    }

    if (!(self.fsm.current === 'paused' || self.fsm.current === 'pausing')) {
      throw new Error(`Cannot resume bot ${self.settings.name} from state "${self.fsm.current}"`);
    }

    const commandArray = [];

    const resumeDoneCommand = {
      postCallback: () => {
        function capitalizeFirstLetter(string) {
          return string.charAt(0).toUpperCase() + string.slice(1);
        }

        const command = 'resume' + capitalizeFirstLetter(self.pauseableState);
        // Resume the bot
        self.fsm[command]();
        if (self.pauseableState === 'executingJob') {
          self.lr.resume();
        }
      },
    };

    const resumeMotion = [
      purgeCommands(self),
      {
        code: self.pausedPosition === undefined ? 'M114' : `G92 E${self.pausedPosition.e}`,
      },
      {
        code: self.pausedPosition === undefined ? 'M114' : `G1 X${self.pausedPosition.x} Y${self.pausedPosition.y} Z${self.pausedPosition.z} F2000`
      },
      {
        preCallback: () => {
          self.logger.debug('Starting resume motion');
        },
        code: 'M400',
        postCallback: () => {
          self.pausedPosition = undefined;
          self.queue.prependCommands(resumeDoneCommand);
          self.logger.debug('Done with resume motion');
        }
      }
    ];

    const resumeStartCommand = {
      postCallback: () => {
        self.logger.debug('starting resume commands');
        self.queue.prependCommands(resumeMotion);
        // Resume the job
        self.currentJob.resume();
      },
    }

    if (self.fsm.current === 'pausing') {
      commandArray.push({
        postCallback: () => {
          self.fsm.resume();
        }
      });
    }

    commandArray.push(resumeStartCommand);
    self.queue.queueCommands(commandArray);

    // Queue the resume command if currently 'pausing'
    if (self.fsm.current === 'paused') {
      // Resume the bot
      self.fsm.resume();
    }

  } catch (ex) {
    self.logger.error('Resume error', ex);
  }
  return self.getBot();
};