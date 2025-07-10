jQuery(document).ready(function ($) {
    let selectedImages = [];
    let currentProductId = null;

    // Search products
    $('#search-products').on('click', function () {
        let searchTerm = $('#product-search').val();
        searchProducts(searchTerm, false);
    });

    $('#load-all-products').on('click', function () {
        searchProducts('', true);
    });

    // Enter key for search
    $('#product-search').on('keypress', function (e) {
        if (e.which === 13) {
            $('#search-products').click();
        }
    });

    function searchProducts(searchTerm, loadAll) {
        $('#search-loading').show();
        $('#products-list').html('');
        $('#images-grid').html('');

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            data: {
                action: 'search_products',
                search_term: searchTerm,
                load_all: loadAll,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    displayProducts(response.data.products);
                    $('#product-count').text('(' + response.data.total + ' products)');
                } else {
                    alert('Search failed');
                }
            },
            complete: function () {
                $('#search-loading').hide();
            }
        });
    }

    function displayProducts(products) {
        let html = '<div class=\"products-grid\">';

        products.forEach(function (product) {
            html += '<div class=\"product-card\" data-product-id=\"' + product.id + '\">';
            html += '<div class=\"product-thumbnail\">';
            if (product.thumbnail_url) {
                html += '<img src=\"' + product.thumbnail_url + '\" alt=\"Product thumbnail\">';
            } else {
                html += '<div class=\"no-image\">No Image</div>';
            }
            html += '</div>';
            html += '<div class=\"product-info\">';
            html += '<h3>' + product.title + '</h3>';
            html += '<p>ID: ' + product.id + ' | Images: ' + product.image_count + '</p>';
            html += '<button class=\"button load-images\" data-product-id=\"' + product.id + '\">Load Images</button>';
            html += '<a href=\"' + product.edit_url + '\" class=\"button\" target=\"_blank\">Edit Product</a>';
            html += '</div>';
            html += '</div>';
        });

        html += '</div>';
        $('#products-list').html(html);
    }

    // Load images for product
    $(document).on('click', '.load-images', function () {
        let productId = $(this).data('product-id');
        currentProductId = productId;

        // Highlight selected product
        $('.product-card').removeClass('selected');
        $(this).closest('.product-card').addClass('selected');

        loadProductImages(productId);
    });

    function loadProductImages(productId) {
        $('#images-grid').html('<div class=\"loading\">Loading images...</div>');
        selectedImages = [];
        updateSelectedCount();

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            data: {
                action: 'get_product_images',
                product_id: productId,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    displayImages(response.data.images, response.data.product_title);
                } else {
                    $('#images-grid').html('<div class=\"error\">Failed to load images</div>');
                }
            }
        });
    }

    function displayImages(images, productTitle) {
        let html = '<h3>Images for: ' + productTitle + '</h3>';
        html += '<div class=\"images-container\">';

        images.forEach(function (image) {
            html += '<div class=\"image-item\" data-image-id=\"' + image.id + '\">';
            html += '<div class=\"image-checkbox\">';
            html += '<input type=\"checkbox\" id=\"img_' + image.id + '\" value=\"' + image.id + '\">';
            html += '</div>';
            html += '<div class=\"image-preview\">';
            html += '<img src=\"' + image.url + '\" alt=\"' + image.title + '\">';
            if (image.badge) {
                html += '<div class="thumbnail-badge">' + image.badge + '</div>';
            }
            html += '</div>';
            html += '<div class=\"image-info\">';
            html += '<p><strong>ID:</strong> ' + image.id + '</p>';
            html += '<p><strong>Size:</strong> ' + image.size + '</p>';
            html += '<button class=\"button button-small crop-single\" data-image-id=\"' + image.id + '\">Crop This</button>';
            html += '<a href=\"' + image.full_url + '\" target=\"_blank\" class=\"button button-small\">View Full</a>';
            html += '</div>';
            html += '</div>';
        });

        html += '</div>';
        $('#images-grid').html(html);
    }

    // Select/Deselect images
    $(document).on('change', '#images-grid input[type=\"checkbox\"]', function () {
        let imageId = parseInt($(this).val());

        if ($(this).is(':checked')) {
            if (selectedImages.indexOf(imageId) === -1) {
                selectedImages.push(imageId);
            }
        } else {
            selectedImages = selectedImages.filter(id => id !== imageId);
        }

        updateSelectedCount();
    });

    $('#select-all-images').on('click', function () {
        $('#images-grid input[type=\"checkbox\"]').prop('checked', true).trigger('change');
    });

    $('#deselect-all-images').on('click', function () {
        $('#images-grid input[type=\"checkbox\"]').prop('checked', false).trigger('change');
    });

    function updateSelectedCount() {
        $('#selected-count').text(selectedImages.length + ' selected');
        $('#crop-selected').prop('disabled', selectedImages.length === 0);
    }

    // Crop single image
    $(document).on('click', '.crop-single', function () {
        let imageId = $(this).data('image-id');
        let button = $(this);

        button.prop('disabled', true).text('Cropping...');

        $.ajax({
            url: ajax_object.ajax_url,
            type: 'POST',
            data: {
                action: 'crop_single_image',
                image_id: imageId,
                nonce: ajax_object.nonce
            },
            success: function (response) {
                if (response.success) {
                    button.text('✓ Cropped').addClass('cropped');
                    showResult(response.data, 'single');

                    // Refresh image preview
                    refreshImagePreview(imageId);
                } else {
                    button.text('❌ Failed').addClass('failed');
                    showResult(response.data, 'single');
                }
            },
            complete: function () {
                setTimeout(function () {
                    button.prop('disabled', false);
                    if (!button.hasClass('cropped') && !button.hasClass('failed')) {
                        button.text('Crop This');
                    }
                }, 2000);
            }
        });
    });

    // Crop selected images
    $('#crop-selected').on('click', function () {
        if (selectedImages.length === 0) {
            alert('Please select images to crop');
            return;
        }

        if (!confirm('Crop ' + selectedImages.length + ' selected images? This will modify the original files.')) {
            return;
        }

        startBulkCrop();
    });

    function startBulkCrop() {
        $('#progress-section').show();
        $('#crop-selected').prop('disabled', true).text('Cropping...');

        let total = selectedImages.length;
        let completed = 0;
        let results = [];

        // Process images one by one to avoid server overload
        function processNext() {
            if (completed >= total) {
                // All done
                completeBulkCrop(results);
                return;
            }

            let imageId = selectedImages[completed];
            updateProgress(completed + 1, total, 'Cropping image ID: ' + imageId);

            $.ajax({
                url: ajax_object.ajax_url,
                type: 'POST',
                data: {
                    action: 'crop_single_image',
                    image_id: imageId,
                    nonce: ajax_object.nonce
                },
                success: function (response) {
                    results.push(response.data || response);

                    if (response.success) {
                        refreshImagePreview(imageId);
                        logProgress('✓ Image ' + imageId + ' cropped successfully');
                    } else {
                        logProgress('❌ Image ' + imageId + ' failed: ' + (response.data?.message || 'Unknown error'));
                    }
                },
                error: function () {
                    results.push({ success: false, image_id: imageId, message: 'AJAX error' });
                    logProgress('❌ Image ' + imageId + ' failed: AJAX error');
                },
                complete: function () {
                    completed++;
                    setTimeout(processNext, 500); // Small delay between requests
                }
            });
        }

        processNext();
    }

    function updateProgress(current, total, message) {
        let percentage = (current / total) * 100;
        $('#progress-fill').css('width', percentage + '%');
        $('#progress-text').text(current + ' / ' + total + ' - ' + message);
    }

    function logProgress(message) {
        let currentLog = $('#progress-log').html();
        $('#progress-log').html(message + '<br>' + currentLog);
    }

    function completeBulkCrop(results) {
        $('#crop-selected').prop('disabled', false).text('Crop Selected Images');

        let successCount = results.filter(r => r.success).length;
        let errorCount = results.length - successCount;

        updateProgress(results.length, results.length, 'Completed!');
        logProgress('<strong>Summary: ' + successCount + ' successful, ' + errorCount + ' failed</strong>');

        showResult({
            summary: {
                total: results.length,
                success: successCount,
                errors: errorCount
            },
            results: results
        }, 'bulk');

        // Clear selection
        selectedImages = [];
        $('#images-grid input[type=\"checkbox\"]').prop('checked', false);
        updateSelectedCount();
    }

    function refreshImagePreview(imageId) {
        // Add timestamp to image URL to force refresh
        let imageItem = $('.image-item[data-image-id=\"' + imageId + '\"]');
        let img = imageItem.find('img');
        let currentSrc = img.attr('src');

        if (currentSrc) {
            let newSrc = currentSrc.split('?')[0] + '?v=' + Date.now();
            img.attr('src', newSrc);
        }
    }

    function showResult(data, type) {
        let html = '<div class=\"result-item ' + type + '\">';
        html += '<h4>' + (type === 'bulk' ? 'Bulk Crop Results' : 'Single Crop Result') + '</h4>';

        if (type === 'bulk' && data.summary) {
            html += '<div class=\"summary\">';
            html += '<p><strong>Total:</strong> ' + data.summary.total + '</p>';
            html += '<p><strong>Successful:</strong> ' + data.summary.success + '</p>';
            html += '<p><strong>Failed:</strong> ' + data.summary.errors + '</p>';
            html += '</div>';
        } else {
            html += '<p><strong>Image ID:</strong> ' + data.image_id + '</p>';
            html += '<p><strong>Status:</strong> ' + (data.success ? 'Success' : 'Failed') + '</p>';
            html += '<p><strong>Message:</strong> ' + (data.message || 'No message') + '</p>';
            if (data.new_size) {
                html += '<p><strong>New Size:</strong> ' + data.new_size + '</p>';
            }
        }

        html += '<small>' + new Date().toLocaleTimeString() + '</small>';
        html += '</div>';

        $('#results-container').prepend(html);
    }

    // Initial load of all products
    searchProducts('', true);
});