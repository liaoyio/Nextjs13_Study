'use server'

import { Question, Tag, User, Answer, Interaction } from '@/database'
import { connectToDatabase } from '../mongoose'
import { revalidatePath } from 'next/cache'

import type {
  CreateQuestionParams,
  DeleteQuestionParams,
  EditQuestionParams,
  GetQuestionByIdParams,
  GetQuestionsParams,
  QuestionVoteParams,
  RecommendedParams
} from './shared.types'

import { FilterQuery } from 'mongoose'

export async function getQuestions(params: GetQuestionsParams) {
  try {
    connectToDatabase()

    const { searchQuery, filter, page = 1, pageSize = 10 } = params

    // Calculcate the number of posts to skip based on the page number and page size
    const skipAmount = (page - 1) * pageSize

    const query: FilterQuery<typeof Question> = {}

    if (searchQuery) {
      query.$or = [
        { title: { $regex: new RegExp(searchQuery, 'i') } },
        { content: { $regex: new RegExp(searchQuery, 'i') } }
      ]
    }

    let sortOptions = {}

    switch (filter) {
      case 'newest':
        sortOptions = { createdAt: -1 }
        break
      case 'frequent':
        sortOptions = { views: -1 }
        break
      case 'unanswered':
        query.answers = { $size: 0 }
        break
      default:
        sortOptions = { createdAt: -1 }
        break
    }

    const questions = await Question.find(query)
      .populate({ path: 'tags', model: Tag })
      .populate({ path: 'author', model: User })
      .skip(skipAmount)
      .limit(pageSize)
      .sort(sortOptions)

    const totalQuestions = await Question.countDocuments(query)

    // 101? = 4 * 20 + 20 = 100
    const isNext = totalQuestions > skipAmount + questions.length

    return { questions, isNext }
  } catch (error) {
    console.log(error)
    throw error
  }
}

export async function createQuestion(params: CreateQuestionParams) {
  try {
    connectToDatabase()
    const { title, content, tags, author, path } = params

    // 创建问题
    const question = await Question.create({
      title,
      content,
      author
    })

    const tagDocuments = []

    // 遍历传入的标签，如果标签不存在则创建标签
    for (const tag of tags) {
      const existingTag = await Tag.findOneAndUpdate(
        // 通过正则表达式匹配标签
        { name: { $regex: new RegExp(`^${tag}$`, 'i') } },
        // 如果标签存在则更新标签的问题列表，如果标签不存在则创建标签
        { $setOnInsert: { name: tag }, $push: { questions: question._id } },
        { upsert: true, new: true }
      )
      tagDocuments.push(existingTag._id)
    }

    // 按照标签的ID查找并更新
    await Question.findByIdAndUpdate(question._id, {
      $push: { tags: { $each: tagDocuments } }
    })

    // Create an interaction record for the user's ask_question action
    await Interaction.create({
      user: author,
      action: 'ask_question',
      question: question._id,
      tags: tagDocuments
    })
    // Increment author's reputation by +5 for creating a question
    await User.findByIdAndUpdate(author, { $inc: { reputation: 5 } })

    // 重新验证路径
    revalidatePath(path)
  } catch (error) {
    console.log(error)
    throw error
  }
}

export async function getQuestionById(params: GetQuestionByIdParams) {
  try {
    connectToDatabase()

    const { questionId } = params

    const question = await Question.findById(questionId)
      .populate({ path: 'tags', model: Tag, select: '_id name' })
      .populate({
        path: 'author',
        model: User,
        select: '_id clerkId name picture'
      })

    return question
  } catch (error) {
    console.log(error)
    throw error
  }
}

export async function upvoteQuestion(params: QuestionVoteParams) {
  try {
    connectToDatabase()

    const { questionId, userId, hasupVoted, hasdownVoted, path } = params

    let updateQuery = {}

    if (hasupVoted) {
      updateQuery = { $pull: { upvotes: userId } }
    } else if (hasdownVoted) {
      updateQuery = {
        $pull: { downvotes: userId },
        $push: { upvotes: userId }
      }
    } else {
      updateQuery = { $addToSet: { upvotes: userId } }
    }

    const question = await Question.findByIdAndUpdate(questionId, updateQuery, {
      new: true
    })

    if (!question) {
      throw new Error('Question not found')
    }

    // Increment author's reputation by +1/-1 for upvoting/revoking an upvote to the question
    await User.findByIdAndUpdate(userId, {
      $inc: { reputation: hasupVoted ? -1 : 1 }
    })

    // Increment author's reputation by +10/-10 for recieving an upvote/downvote to the question
    await User.findByIdAndUpdate(question.author, {
      $inc: { reputation: hasupVoted ? -10 : 10 }
    })

    revalidatePath(path)
  } catch (error) {
    console.log(error)
    throw error
  }
}

export async function downvoteQuestion(params: QuestionVoteParams) {
  try {
    connectToDatabase()

    const { questionId, userId, hasupVoted, hasdownVoted, path } = params

    let updateQuery = {}

    if (hasdownVoted) {
      updateQuery = { $pull: { downvotes: userId } }
    } else if (hasupVoted) {
      updateQuery = {
        $pull: { upvotes: userId },
        $push: { downvotes: userId }
      }
    } else {
      updateQuery = { $addToSet: { downvotes: userId } }
    }

    const question = await Question.findByIdAndUpdate(questionId, updateQuery, {
      new: true
    })

    if (!question) {
      throw new Error('Question not found')
    }

    // Increment author's reputation
    await User.findByIdAndUpdate(userId, {
      $inc: { reputation: hasdownVoted ? -2 : 2 }
    })

    await User.findByIdAndUpdate(question.author, {
      $inc: { reputation: hasdownVoted ? -10 : 10 }
    })

    revalidatePath(path)
  } catch (error) {
    console.log(error)
    throw error
  }
}

export async function deleteQuestion(params: DeleteQuestionParams) {
  try {
    connectToDatabase()
    const { questionId, path } = params

    await Question.deleteOne({ _id: questionId })
    await Answer.deleteMany({ question: questionId })
    await Interaction.deleteMany({ question: questionId })
    await Tag.updateMany({ questions: questionId }, { $pull: { questions: questionId } })

    revalidatePath(path)
  } catch (error) {
    console.log(error)
    throw error
  }
}

/** 编辑问题 */
export async function editQuestion(params: EditQuestionParams) {
  try {
    connectToDatabase()

    const { questionId, title, content, path } = params

    const question = await Question.findById(questionId).populate('tags')

    if (!question) {
      throw new Error('Question not found')
    }

    question.title = title
    question.content = content

    await question.save()

    revalidatePath(path)
  } catch (error) {
    console.log(error)
    throw error
  }
}

/* 获取热门问题 */
export async function getHotQuestions() {
  try {
    connectToDatabase()

    const hotQuestions = await Question.find({}).sort({ views: -1, upvotes: -1 }).limit(5)

    return hotQuestions
  } catch (error) {
    console.log(error)
    throw error
  }
}

export async function getRecommendedQuestions(params: RecommendedParams) {
  try {
    await connectToDatabase()

    const { userId, page = 1, pageSize = 20, searchQuery } = params

    // find user
    const user = await User.findOne({ clerkId: userId })

    if (!user) {
      throw new Error('user not found')
    }

    const skipAmount = (page - 1) * pageSize

    // Find the user's interactions
    const userInteractions = await Interaction.find({ user: user._id }).populate('tags').exec()

    // Extract tags from user's interactions
    const userTags = userInteractions.reduce((tags, interaction) => {
      if (interaction.tags) {
        tags = tags.concat(interaction.tags)
      }
      return tags
    }, [])

    // Get distinct tag IDs from user's interactions
    const distinctUserTagIds = [
      // @ts-ignore
      ...new Set(userTags.map((tag: any) => tag._id))
    ]

    const query: FilterQuery<typeof Question> = {
      $and: [
        { tags: { $in: distinctUserTagIds } }, // Questions with user's tags
        { author: { $ne: user._id } } // Exclude user's own questions
      ]
    }

    if (searchQuery) {
      query.$or = [
        { title: { $regex: searchQuery, $options: 'i' } },
        { content: { $regex: searchQuery, $options: 'i' } }
      ]
    }

    const totalQuestions = await Question.countDocuments(query)

    const recommendedQuestions = await Question.find(query)
      .populate({
        path: 'tags',
        model: Tag
      })
      .populate({
        path: 'author',
        model: User
      })
      .skip(skipAmount)
      .limit(pageSize)

    const isNext = totalQuestions > skipAmount + recommendedQuestions.length

    return { questions: recommendedQuestions, isNext }
  } catch (error) {
    console.error('Error getting recommended questions:', error)
    throw error
  }
}
