const mongoose = require('mongoose');

/**
 * Pick a random Active animal matching `filter`, returning `{ _id }` or null.
 *
 * X4 (Sprint 5): cost-rounding remainder previously went to `Animal.findOne`
 * (which always returns the oldest by _id). Over many feed/vaccine/salary
 * applications that one animal accumulated artificially-inflated cost
 * totals vs. its siblings. Using `$sample` distributes the bias uniformly.
 *
 * @param {object} filter   Additional match conditions (e.g. { pen: penId }).
 * @param {import('mongoose').ClientSession?} session
 */
const sampleActiveAnimal = async (filter = {}, session = null) => {
  const Animal = mongoose.model('Animal');
  const pipeline = [
    { $match: { ...filter, status: 'Active' } },
    { $sample: { size: 1 } },
    { $project: { _id: 1 } }
  ];
  const agg = Animal.aggregate(pipeline);
  if (session) agg.session(session);
  const result = await agg.exec();
  return result[0] || null;
};

module.exports = { sampleActiveAnimal };
