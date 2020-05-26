import VtexSeller from './models/VtexSeller'
import unescape from 'unescape'

export enum IndexingType {
  API = 'API',
  XML = 'XML',
}

interface ExtraData {
  key: string
  value: string
}

interface BreadcrumbItem {
  name: string
  href: string
}

export const convertBiggyProduct = (
  product: any,
  tradePolicy?: string,
  indexingType?: IndexingType
) => {
  const categories: string[] = product.categories
    ? product.categories.map((_: any, index: number) => {
        const subArray = product.categories.slice(0, index)
        return `/${subArray.join('/')}/`
      })
    : []

  const skus: any[] = (product.skus || []).map(
    convertSKU(product, indexingType, tradePolicy)
  )

  const convertedProduct: any = {
    categories,
    productId: product.id,
    cacheId: `sp-${product.id}`,
    productName: product.name,
    productReference: product.reference || product.product || product.id,
    linkText: product.link,
    brand:
      product.brand ||
      product.extraInfo['marca'] ||
      product.extraInfo['brand'] ||
      '',
    brandId: -1,
    link: product.url,
    description: product.description,
    items: skus,
    sku: skus.find(sku => sku.sellers && sku.sellers.length > 0),
    allSpecifications: [],
  }

  if (product.extraData) {
    product.extraData.forEach(({ key, value }: ExtraData) => {
      convertedProduct.allSpecifications.push(key)
      convertedProduct[key] = [value]
    })
  }

  return convertedProduct
}

const getSellersIndexedByApi = (
  product: any,
  sku: any,
  tradePolicy?: string
) => {
  const selectedPolicy = tradePolicy
    ? sku.policies.find((policy: any) => policy.id === tradePolicy)
    : sku.policies[0]

  const biggySellers = (selectedPolicy && selectedPolicy.sellers) || []

  return biggySellers.map((seller: any) => {
    const price = seller.price || sku.price || product.price
    const oldPrice = seller.oldPrice || sku.oldPrice || product.oldPrice
    const installment = seller.installment || product.installment

    return new VtexSeller(seller.id, price, oldPrice, installment)
  })
}

const getSellersIndexedByXML = (product: any) => {
  const { installment, price, oldPrice } = product
  return [new VtexSeller('1', price, oldPrice, installment)]
}

const getImageId = (imageUrl: string) => {
  const baseUrlRegex = new RegExp(/.+ids\/(\d+)/)
  return baseUrlRegex.test(imageUrl)
    ? baseUrlRegex.exec(imageUrl)![1]
    : undefined
}

const elasticImageToVtexImage = (image: ElasticImage, imageId: string) => {
  return {
    imageId,
    cacheId: imageId,
    imageLabel: image.name,
    imageText: image.name,
    imageUrl: image.value,
  }
}

const convertImages = (images: ElasticImage[], indexingType?: IndexingType) => {
  const vtexImages: VtexImage[] = []

  if (indexingType && indexingType === IndexingType.XML) {
    const selectedImage: ElasticImage = images[0]
    const imageId = getImageId(selectedImage.value)

    return imageId ? [elasticImageToVtexImage(selectedImage, imageId)] : []
  }

  images.forEach(image => {
    const imageId = getImageId(image.value)
    imageId ? vtexImages.push(elasticImageToVtexImage(image, imageId)) : []
  })

  return vtexImages
}

const convertSKU = (
  product: any,
  indexingType?: IndexingType,
  tradePolicy?: string
) => (sku: any) => {
  const images = convertImages(product.images, indexingType)

  const sellers =
    indexingType === IndexingType.XML
      ? getSellersIndexedByXML(product)
      : getSellersIndexedByApi(product, sku, tradePolicy)

  return {
    sellers,
    images,
    seller: sellers[0],
    itemId: sku.id,
    name: product.name,
    nameComplete: product.name,
    complementName: product.name,
    referenceId: [
      {
        Key: 'RefId',
        Value: sku.reference,
      },
    ],
  }
}

export const biggyAttributesToVtexFilters = (attributes: any) =>
  attributes.map((attribute: any) => {
    const isNumber = attribute.type === 'number'

    return {
      name: attribute.label,
      type: isNumber
        ? attribute.key === 'price'
          ? 'PRICERANGE'
          : 'NUMBER'
        : attribute.type.toUpperCase(),
      hidden: !attribute.visible,
      values:
        isNumber && attribute.key === 'price'
          ? [
              {
                quantity: attribute.values.reduce(
                  (acum: number, value: any) => acum + value.count,
                  0
                ),
                name: unescape(attribute.label),
                key: attribute.key,
                value: attribute.key,
                range: {
                  from: attribute.minValue,
                  to: attribute.maxValue,
                },
              },
            ]
          : isNumber
          ? attribute.values.map((value: any) => {
              return {
                quantity: value.count,
                name: unescape(`${value.from} - ${value.to}`),
                key: attribute.key,
                value: `${value.from}:${value.to}`,
                selected: value.active,
                range: {
                  from: value.from !== '*' ? value.from : attribute.minValue,
                  to: value.to !== '*' ? value.to : attribute.maxValue,
                },
              }
            })
          : attribute.values.map((value: any) => {
              return {
                quantity: value.count,
                name: unescape(value.label),
                key: attribute.key,
                value: value.key,
                selected: value.active,
              }
            }),
    }
  })

/**
 * Convert from VTEX OrderBy into Biggy's sort.
 *
 * @export
 * @param {OrderBy} orderBy VTEX OrderBy.
 * @returns {string} Biggy's sort.
 */
export const convertOrderBy = (orderBy?: string): string => {
  switch (orderBy) {
    case 'OrderByPriceDESC':
      return 'price:desc'
    case 'OrderByPriceASC':
      return 'price:asc'
    case 'OrderByTopSaleDESC':
      return 'orders:desc'
    case 'OrderByReviewRateDESC':
      return '' // TODO: Not Supported
    case 'OrderByNameDESC':
      return 'name:desc'
    case 'OrderByNameASC':
      return 'name:asc'
    case 'OrderByReleaseDateDESC':
      return 'release:desc'
    case 'OrderByBestDiscountDESC':
      return 'discount:desc'
    default:
      return ''
  }
}

export const buildBreadcrumb = (
  attributes: ElasticAttribute[],
  fullText: string
) => {
  const pivotValue: string[] = []
  const pivotMap: string[] = []

  const breadcrumb: BreadcrumbItem[] = []

  if (fullText) {
    pivotValue.push(fullText)
    pivotMap.push('ft')

    breadcrumb.push({
      name: fullText,
      href: `/${pivotValue.join('/')}?map=${pivotMap.join(',')}`,
    })
  }

  const activeAttributes = attributes.filter(attribute => attribute.active)

  activeAttributes.map(attribute => {
    attribute.values.forEach(value => {
      if (!value.active) {
        return
      }

      pivotValue.push(value.key)
      pivotMap.push(attribute.key)

      breadcrumb.push({
        name: unescape(value.label),
        href: `/${pivotValue.join('/')}?map=${pivotMap.join(',')}`,
      })
    })
  })

  return breadcrumb
}

export const buildAttributePath = (selectedFacets: SelectedFacet[]) => {
  return selectedFacets
    ? selectedFacets.reduce((attributePath, facet) => {
        if (facet.key === 'priceRange') {
          facet.key = 'price'
          facet.value = facet.value.replace(` TO `, ':')
        }

        return facet.key !== 'ft'
          ? `${attributePath}${facet.key}/${facet.value.replace(/ |%20/, '-')}/`
          : attributePath
      }, '')
    : ''
}
